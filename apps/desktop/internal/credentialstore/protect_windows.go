//go:build windows

package credentialstore

import (
	"unsafe"

	"golang.org/x/sys/windows"
)

// protection is how this build seals a value: DPAPI, current-user scope (ADR 0405 Q10).
const protection = "dpapi"

// entropy ties a sealed value to this app: another program of the same Windows user calling CryptUnprotectData on the
// blob also needs these bytes. It is not a secret, only a scope.
var entropy = []byte("narration-utils credentialstore v1")

func blob(b []byte) *windows.DataBlob {
	if len(b) == 0 {
		return &windows.DataBlob{}
	}
	return &windows.DataBlob{Size: uint32(len(b)), Data: &b[0]} //nolint:gosec // G115: a key or its sealed blob is a few hundred bytes, never 4 GiB
}

func protect(plain []byte) ([]byte, error) {
	var out windows.DataBlob
	if err := windows.CryptProtectData(blob(plain), nil, blob(entropy), 0, nil, windows.CRYPTPROTECT_UI_FORBIDDEN, &out); err != nil {
		return nil, err
	}
	return takeBlob(out), nil
}

func unprotect(sealed []byte) ([]byte, error) {
	var out windows.DataBlob
	if err := windows.CryptUnprotectData(blob(sealed), nil, blob(entropy), 0, nil, windows.CRYPTPROTECT_UI_FORBIDDEN, &out); err != nil {
		return nil, err
	}
	return takeBlob(out), nil
}

// takeBlob copies a DPAPI output buffer into Go memory and frees it, zeroing it first.
func takeBlob(out windows.DataBlob) []byte {
	if out.Data == nil {
		return nil
	}
	defer func() { _, _ = windows.LocalFree(windows.Handle(unsafe.Pointer(out.Data))) }() //nolint:gosec // G103: DPAPI hands back a LocalAlloc buffer that only LocalFree releases
	view := unsafe.Slice(out.Data, out.Size)                                              //nolint:gosec // G103: the buffer DPAPI filled, read once and copied out before it is freed
	copied := make([]byte, len(view))
	copy(copied, view)
	clear(view)
	return copied
}
