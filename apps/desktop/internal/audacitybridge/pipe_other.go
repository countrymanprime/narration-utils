//go:build !windows

package audacitybridge

import "context"

// PipeTransport has no pipe outside Windows: the app is Windows-only (D74), and this keeps the package building for the
// platform-neutral checks. Every dial is ErrUnsupportedPlatform.
func PipeTransport() Transport {
	return TransportFunc(func(context.Context) (Conn, error) { return nil, ErrUnsupportedPlatform })
}
