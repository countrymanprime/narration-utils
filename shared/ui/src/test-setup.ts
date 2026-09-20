// Vitest 4's jsdom compat layer wraps URL.createObjectURL and reads a private
// `_buffer` field off jsdom's Blob implementation, which jsdom 30 no longer
// has, so the real call throws. No test needs a real blob URL - the audio
// element is never actually loaded - so hand back a stable fake instead.
URL.createObjectURL = () => 'blob:vitest-object-url';
URL.revokeObjectURL = () => undefined;
