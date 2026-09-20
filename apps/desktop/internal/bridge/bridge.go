// Package bridge implements the versioned, file-based IPC contract with the
// REAPER Lua launcher. Its percent encoding deliberately matches Python's
// urllib.parse.quote(value, safe="") byte-for-byte.
package bridge

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
)

const ProtocolVersion = 1

func EncodeFields(fields []string) string {
	encoded := make([]string, len(fields))
	for index, field := range fields {
		encoded[index] = PercentEncode(field)
	}
	return strings.Join(encoded, "|")
}

func DecodeFields(line string) ([]string, error) {
	parts := strings.Split(strings.TrimRight(line, "\r\n"), "|")
	decoded := make([]string, len(parts))
	for index, part := range parts {
		value, err := percentDecode(part)
		if err != nil {
			return nil, err
		}
		decoded[index] = value
	}
	return decoded, nil
}

func PercentEncode(value string) string {
	const hex = "0123456789ABCDEF"
	var builder strings.Builder
	for _, byteValue := range []byte(value) {
		if byteValue >= 'a' && byteValue <= 'z' || byteValue >= 'A' && byteValue <= 'Z' || byteValue >= '0' && byteValue <= '9' || byteValue == '-' || byteValue == '.' || byteValue == '_' || byteValue == '~' {
			builder.WriteByte(byteValue)
			continue
		}
		builder.WriteByte('%')
		builder.WriteByte(hex[byteValue>>4])
		builder.WriteByte(hex[byteValue&0x0f])
	}
	return builder.String()
}

type Client struct {
	mu          sync.Mutex
	sessionDir  string
	counter     uint64
	eventOffset int64
}

func New(sessionDir string) (*Client, error) {
	if err := os.MkdirAll(filepath.Join(sessionDir, "commands"), 0o755); err != nil {
		return nil, fmt.Errorf("could not create bridge command directory: %w", err)
	}
	return &Client{sessionDir: sessionDir}, nil
}

func (c *Client) Send(action string, fields []string) (string, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	target := filepath.Join(c.sessionDir, "commands", fmt.Sprintf("%08d.cmd", c.counter))
	c.counter++
	values := append([]string{fmt.Sprint(ProtocolVersion), action}, fields...)
	temporary := target + ".tmp"
	if err := os.WriteFile(temporary, []byte(EncodeFields(values)+"\n"), 0o600); err != nil {
		return "", fmt.Errorf("could not write bridge command: %w", err)
	}
	if err := os.Rename(temporary, target); err != nil {
		return "", fmt.Errorf("could not activate bridge command: %w", err)
	}
	return target, nil
}

func (c *Client) ReadEvents() ([]string, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	bytes, err := os.ReadFile(filepath.Join(c.sessionDir, "events.log"))
	if os.IsNotExist(err) {
		return []string{}, nil
	}
	if err != nil {
		return nil, err
	}
	offset := c.eventOffset
	if offset < 0 || offset > int64(len(bytes)) {
		offset = int64(len(bytes))
	}
	c.eventOffset = int64(len(bytes))
	text := string(bytes[offset:])
	result := []string{}
	for _, line := range strings.Split(text, "\n") {
		if line != "" {
			result = append(result, strings.TrimSuffix(line, "\r"))
		}
	}
	return result, nil
}

func percentDecode(value string) (string, error) {
	bytes := make([]byte, 0, len(value))
	for index := 0; index < len(value); index++ {
		if value[index] != '%' {
			bytes = append(bytes, value[index])
			continue
		}
		if index+2 >= len(value) {
			return "", fmt.Errorf("invalid percent escape")
		}
		hi, okHi := hexValue(value[index+1])
		lo, okLo := hexValue(value[index+2])
		if !okHi || !okLo {
			return "", fmt.Errorf("invalid percent escape")
		}
		bytes = append(bytes, hi<<4|lo)
		index += 2
	}
	return string(bytes), nil
}
func hexValue(value byte) (byte, bool) {
	if value >= '0' && value <= '9' {
		return value - '0', true
	}
	if value >= 'a' && value <= 'f' {
		return value - 'a' + 10, true
	}
	if value >= 'A' && value <= 'F' {
		return value - 'A' + 10, true
	}
	return 0, false
}
