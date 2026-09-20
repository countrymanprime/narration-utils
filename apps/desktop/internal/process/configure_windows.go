//go:build windows

package process

import (
	"os/exec"
	"syscall"
)

const createNoWindow = 0x08000000

func configure(command *exec.Cmd) {
	command.SysProcAttr = &syscall.SysProcAttr{CreationFlags: createNoWindow}
}
