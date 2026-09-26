// Package dawporttest is the conformance suite every DAW port adapter must pass (ADR 0300), and a fake adapter it runs against.
//
// An adapter package runs the suite from its own test:
//
//	func TestConformance(t *testing.T) {
//		dawporttest.Run(t, func(tb testing.TB) dawport.Adapter { return newAdapterOverAClosedTransport(tb) })
//	}
package dawporttest

import (
	"context"
	"errors"
	"fmt"
	"maps"
	"reflect"
	"testing"
	"time"

	"github.com/countrymanprime/narration-utils/shell/internal/dawport"
)

// Factory builds the adapter under test over a closed transport: an engine that has gone away, so every request it makes fails. A
// real adapter wraps a bridge client whose session is closed; the fake is closed with Close.
type Factory func(tb testing.TB) dawport.Adapter

// callTimeout is how long one role call against a closed transport may take before the suite calls it hung. A call must fail fast
// when the engine is gone: the host's loop is waiting on it.
var callTimeout = 5 * time.Second

// Run fails t once per broken promise of the adapter factory builds.
func Run(t *testing.T, factory Factory) {
	t.Helper()
	for _, p := range Problems(t, factory) {
		t.Error(p)
	}
}

// Problems is every way the adapter factory builds breaks the port's contract; empty when it conforms. It checks that:
//   - Kind and Declares are static, and every declared capability and level is one the port knows;
//   - every capability declared Experimental or Supported has a non-nil role of its documented type, and every other has none;
//   - through a Resolver, a usable capability's role comes back from dawport.Role, and every other is refused with a
//     *dawport.NotSupportedError whose reason is on the wire enum and whose message is a sentence for the narrator;
//   - no role method panics, or hangs past callTimeout, against the closed transport.
func Problems(tb testing.TB, factory Factory) []string {
	tb.Helper()
	adapter := factory(tb)
	if adapter == nil {
		return []string{"the factory returned a nil adapter"}
	}
	var problems []string
	report := func(format string, args ...any) { problems = append(problems, fmt.Sprintf(format, args...)) }

	if first, second := adapter.Kind(), adapter.Kind(); first != second {
		report("Kind is not static: two calls answered differently")
	}
	declared := adapter.Declares()
	if !maps.Equal(declared, adapter.Declares()) {
		report("Declares is not static: two calls answered differently")
	}
	for c, level := range declared {
		if _, ok := dawport.SpecOf(c); !ok {
			report("declares %q, which is not a capability", c)
		}
		if level < dawport.Unsupported || level > dawport.Supported {
			report("%s: declares level %d, which is not a dawport.Level", c, int(level))
		}
	}

	usable := map[dawport.Capability]any{}
	for _, spec := range dawport.Capabilities() {
		c, level := spec.Capability, declared[spec.Capability]
		if level > dawport.Supported {
			continue // already reported
		}
		role := adapter.Role(c)
		switch {
		case level < dawport.Experimental && role != nil:
			report("%s: declared %s but Role returned %T; only an Experimental or Supported capability has a role", c, level, role)
		case level >= dawport.Experimental && role == nil:
			report("%s: declared %s but Role returned nil", c, level)
		case level >= dawport.Experimental && !reflect.TypeOf(role).Implements(spec.Role):
			report("%s: Role returned %T, which is not a %v", c, role, spec.Role)
		case level >= dawport.Experimental:
			usable[c] = role
		}
	}

	problems = append(problems, resolverProblems(adapter, declared)...)

	for _, spec := range dawport.Capabilities() {
		if role, ok := usable[spec.Capability]; ok {
			problems = append(problems, closedTransportProblems(spec, role)...)
		}
	}
	return problems
}

// resolverProblems checks the adapter through a Resolver: first with every capability switched on and the engine answering, so
// only the declaration can refuse, then standalone and not running, so every refusal the runtime causes is worded too.
func resolverProblems(adapter dawport.Adapter, declared map[dawport.Capability]dawport.Level) []string {
	var problems []string
	report := func(format string, args ...any) { problems = append(problems, fmt.Sprintf(format, args...)) }
	resolver := func(rt dawport.Runtime) *dawport.Resolver {
		return dawport.NewResolver(dawport.ResolverConfig{
			Adapter: adapter,
			Runtime: func() dawport.Runtime { return rt },
			Toggle:  func(dawport.Capability) dawport.Toggle { return dawport.ToggleOn },
		})
	}

	open := resolver(dawport.Runtime{Bridge: true, Reachable: true})
	for _, spec := range dawport.Capabilities() {
		c, level := spec.Capability, declared[spec.Capability]
		if level > dawport.Supported {
			continue
		}
		check, ok := roleChecks[c]
		if !ok {
			report("%s: the suite has no role check for it", c)
			continue
		}
		role, err := check.get(open, c)
		if level >= dawport.Experimental {
			if err != nil {
				report("%s: dawport.Role refused a usable capability: %v", c, err)
			} else if role == nil {
				report("%s: dawport.Role returned a nil role", c)
			}
			continue
		}
		want := dawport.ReasonUnsupported
		if level == dawport.NotYetAvailable {
			want = dawport.ReasonNotYet
		}
		var refusal *dawport.NotSupportedError
		switch {
		case !errors.As(err, &refusal):
			report("%s: declared %s, but dawport.Role answered %v (%T), not a *dawport.NotSupportedError", c, level, err, err)
		case refusal.Support.Reason != want:
			report("%s: declared %s, but the refusal's reason is %q, not %q", c, level, refusal.Support.Reason, want)
		}
	}

	for _, rt := range []dawport.Runtime{{Bridge: true, Reachable: true}, {Bridge: true}, {}} {
		for c, s := range resolver(rt).All() {
			if s.Available {
				continue
			}
			if !knownReasons[s.Reason] {
				report("%s: refused with reason %q, which is not on the wire enum", c, s.Reason)
			}
			if s.Message == "" {
				report("%s: refused (%s) with no message for the narrator", c, s.Reason)
			}
		}
	}
	return problems
}

var knownReasons = map[dawport.Reason]bool{
	dawport.ReasonStandalone: true, dawport.ReasonNotRunning: true, dawport.ReasonExperimentalOff: true, dawport.ReasonFailed: true,
	dawport.ReasonTurnedOff: true, dawport.ReasonNotYet: true, dawport.ReasonUnsupported: true,
}

// closedTransportProblems calls every method of the capability's role interface on role, with zero arguments (a no-op for a func
// and a deadline-bound context), and reports a call that panics or does not return within callTimeout. An error is the right
// answer against a closed transport and is not reported.
func closedTransportProblems(spec dawport.Spec, role any) []string {
	var problems []string
	value := reflect.ValueOf(role)
	for i := range spec.Role.NumMethod() {
		method := spec.Role.Method(i)
		fn := value.MethodByName(method.Name)
		in := make([]reflect.Type, method.Type.NumIn())
		for j := range in {
			in[j] = method.Type.In(j)
		}
		ctx, cancel := context.WithTimeout(context.Background(), callTimeout)
		done := make(chan any, 1)
		go func() {
			defer func() { done <- recover() }()
			fn.Call(callArgs(ctx, in...))
		}()
		select {
		case p := <-done:
			if p != nil {
				problems = append(problems, fmt.Sprintf("%s: %s panicked against a closed transport: %v", spec.Capability, method.Name, p))
			}
		case <-time.After(callTimeout):
			problems = append(problems, fmt.Sprintf("%s: %s did not return within %v against a closed transport", spec.Capability, method.Name, callTimeout))
		}
		cancel()
	}
	return problems
}

var contextType = reflect.TypeFor[context.Context]()

// callArgs builds one argument per type: ctx for a context, a no-op for a func, and the zero value for anything else.
func callArgs(ctx context.Context, in ...reflect.Type) []reflect.Value {
	args := make([]reflect.Value, len(in))
	for i, t := range in {
		switch {
		case t == contextType:
			args[i] = reflect.ValueOf(ctx)
		case t.Kind() == reflect.Func:
			args[i] = reflect.MakeFunc(t, func([]reflect.Value) []reflect.Value {
				out := make([]reflect.Value, t.NumOut())
				for k := range out {
					out[k] = reflect.Zero(t.Out(k))
				}
				return out
			})
		default:
			args[i] = reflect.Zero(t)
		}
	}
	return args
}

// roleCheck asks the resolver for one capability's role as its documented interface, which is the only way to call dawport.Role
// with a type chosen per capability.
type roleCheck struct {
	want reflect.Type
	get  func(r *dawport.Resolver, c dawport.Capability) (any, error)
}

func check[T any]() roleCheck {
	return roleCheck{
		want: reflect.TypeFor[T](),
		get: func(r *dawport.Resolver, c dawport.Capability) (any, error) {
			role, err := dawport.Role[T](r, c)
			if err != nil {
				return nil, err
			}
			return role, nil
		},
	}
}

// roleChecks has one row per capability; TestEveryCapabilityHasARoleCheck keeps it in step with dawport.Capabilities.
var roleChecks = map[dawport.Capability]roleCheck{
	dawport.CapReview:       check[dawport.ReviewSession](),
	dawport.CapNavigate:     check[dawport.Navigator](),
	dawport.CapMarkers:      check[dawport.MarkerWriter](),
	dawport.CapPickups:      check[dawport.PickupList](),
	dawport.CapLineIdentity: check[dawport.LineStamper](),
	dawport.CapRenderConfig: check[dawport.RenderConfigurer](),
	dawport.CapCleanupTools: check[dawport.CleanupLauncher](),
	dawport.CapRetakeLanes:  check[dawport.RetakeLanePicker](),
	dawport.CapProjectState: check[dawport.ProjectStateReader](),
	dawport.CapTakeCreate:   check[dawport.TakeCreator](),
	dawport.CapHeartbeat:    check[dawport.Heartbeat](),
	dawport.CapProjectRead:  check[dawport.ProjectReader](),
	dawport.CapTrackState:   check[dawport.TrackStateReader](),
	dawport.CapRecord:       check[dawport.Recorder](),
	dawport.CapPunch:        check[dawport.Puncher](),
	dawport.CapRegions:      check[dawport.RegionWriter](),
	dawport.CapTakes:        check[dawport.TakeSelector](),
	dawport.CapFXChains:     check[dawport.FXManager](),
	dawport.CapSilenceTrim:  check[dawport.SilenceTrimmer](),
	dawport.CapItemGain:     check[dawport.GainAdjuster](),
}
