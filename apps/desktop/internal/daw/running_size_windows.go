//go:build windows

package daw

import (
	"unsafe"

	"golang.org/x/sys/windows"
)

const sizeofProcessEntry32 = unsafe.Sizeof(windows.ProcessEntry32{})
