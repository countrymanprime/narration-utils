//go:build !windows

package process

type jobSet struct{}

func newJobSet() jobSet            { return jobSet{} }
func (j *jobSet) assign(int) error { return nil }
func (j *jobSet) close() error     { return nil }
