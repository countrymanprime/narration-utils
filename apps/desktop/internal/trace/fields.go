package trace

import (
	"context"
	"errors"
	"io"
	"os"
	"regexp"
	"time"
)

// Kind is what a field may hold. There is no free-text kind: a record is built from these and nothing else, so text
// cannot reach a line by accident (docs/prds/activity-trace.prd.md).
type Kind uint8

const (
	// KindEnum is one of the values the event's definition lists.
	KindEnum Kind = iota + 1
	// KindInt is a count or a measurement. It is written as a number.
	KindInt
	// KindBool is a flag.
	KindBool
	// KindDuration is a time span, written in milliseconds under name_ms.
	KindDuration
	// KindID is an opaque identifier (a chapter id, a GUID) that matches idPattern. A title or a sentence does not.
	KindID
	// KindPath is a file path, written as {class, ext, h}. The raw path is dropped at emit.
	KindPath
	// KindErr is an error, written as its class from ErrorClass. The message is dropped when the value is built.
	KindErr
	// KindLen is the size of some text, written as a bucket under name_len. The text is dropped when the value is built.
	KindLen
)

var (
	idPattern   = regexp.MustCompile(`^[a-z0-9_.:-]{1,64}$`)
	namePattern = regexp.MustCompile(`^[a-z][a-z0-9_]{0,31}$`)
	extPattern  = regexp.MustCompile(`^\.[a-z0-9]{1,8}$`)
)

// FieldDef declares one field of an event: its name, its kind and, for an enum, the values it may take.
type FieldDef struct {
	name string
	kind Kind
	enum []string
}

// EnumField declares a field that holds one of values.
func EnumField(name string, values ...string) FieldDef {
	return FieldDef{name: name, kind: KindEnum, enum: values}
}

// IntField declares a number field.
func IntField(name string) FieldDef { return FieldDef{name: name, kind: KindInt} }

// BoolField declares a flag field.
func BoolField(name string) FieldDef { return FieldDef{name: name, kind: KindBool} }

// DurField declares a time-span field, written as name_ms.
func DurField(name string) FieldDef { return FieldDef{name: name, kind: KindDuration} }

// IDField declares an opaque-id field.
func IDField(name string) FieldDef { return FieldDef{name: name, kind: KindID} }

// PathField declares a file-path field, written as {class, ext, h}.
func PathField(name string) FieldDef { return FieldDef{name: name, kind: KindPath} }

// ErrField declares an error field, written as its class.
func ErrField(name string) FieldDef { return FieldDef{name: name, kind: KindErr} }

// LenField declares a text-length field, written as a bucket under name_len.
func LenField(name string) FieldDef { return FieldDef{name: name, kind: KindLen} }

// Value is one field's value, built only by the functions below. An error and a text are reduced to a class and a bucket
// when the Value is built, so neither reaches the tracer. A path is held raw until Emit hashes it.
type Value struct {
	name string
	kind Kind
	s    string
	n    int64
}

// EnumValue is an enum field's value. Emit drops it if the definition does not list it.
func EnumValue(name, value string) Value { return Value{name: name, kind: KindEnum, s: value} }

// IntValue is a number field's value.
func IntValue(name string, value int64) Value { return Value{name: name, kind: KindInt, n: value} }

// BoolValue is a flag field's value.
func BoolValue(name string, value bool) Value {
	v := Value{name: name, kind: KindBool}
	if value {
		v.n = 1
	}
	return v
}

// DurValue is a time-span field's value, kept in whole milliseconds.
func DurValue(name string, value time.Duration) Value {
	return Value{name: name, kind: KindDuration, n: value.Milliseconds()}
}

// IDValue is an opaque-id field's value. Emit drops it unless it matches ^[a-z0-9_.:-]{1,64}$.
func IDValue(name, value string) Value { return Value{name: name, kind: KindID, s: value} }

// PathValue is a file-path field's value.
func PathValue(name, path string) Value { return Value{name: name, kind: KindPath, s: path} }

// ErrValue is an error field's value: its ErrorClass, never its message.
func ErrValue(name string, err error) Value {
	return Value{name: name, kind: KindErr, s: ErrorClass(err)}
}

// LenValue is a text-length field's value: the LengthBucket of text, never the text.
func LenValue(name, text string) Value {
	return Value{name: name, kind: KindLen, s: LengthBucket(text)}
}

// ErrorClass names what kind of failure err is, from a fixed list. The message is never used: it can hold a path or
// the narrator's text.
func ErrorClass(err error) string {
	switch {
	case err == nil:
		return "none"
	case errors.Is(err, context.DeadlineExceeded), errors.Is(err, os.ErrDeadlineExceeded):
		return "timeout"
	case errors.Is(err, context.Canceled):
		return "canceled"
	case errors.Is(err, os.ErrNotExist):
		return "not_found"
	case errors.Is(err, os.ErrPermission):
		return "permission"
	case errors.Is(err, os.ErrExist):
		return "exists"
	case errors.Is(err, io.EOF), errors.Is(err, io.ErrUnexpectedEOF):
		return "eof"
	case errors.Is(err, os.ErrClosed):
		return "closed"
	default:
		return "other"
	}
}

// LengthBucket sizes text as "0", "1-9", "10-99", "100-999" or "1000+" bytes, so a record says how much was typed and not
// what.
func LengthBucket(text string) string {
	n := len(text)
	switch {
	case n == 0:
		return "0"
	case n < 10:
		return "1-9"
	case n < 100:
		return "10-99"
	case n < 1000:
		return "100-999"
	default:
		return "1000+"
	}
}
