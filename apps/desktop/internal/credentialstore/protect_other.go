//go:build !windows

package credentialstore

// protection is how this build seals a value: not at all. Windows is the only supported platform (D74); a build
// elsewhere keeps the value in the clear in its owner-only file, and ProtectedAtRest says so (ADR 0405 Q10).
const protection = "none"

func protect(plain []byte) ([]byte, error) { return append([]byte(nil), plain...), nil }

func unprotect(sealed []byte) ([]byte, error) { return append([]byte(nil), sealed...), nil }
