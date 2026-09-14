namespace NarrationUtilsHub.Tests;

/// <summary>Verifies the on-disk command protocol used by the Lua adapter.</summary>
public sealed class BridgeTests
{
    [Fact]
    public void SerializeRoundTripsDelimitersAndUnicode()
    {
        var withUnicode = @"C:\tools\a|b.py " + "\u2713";
        var serialized = BridgeProtocol.Serialize("runtime_setting", "TranscriptCompare", "compare_script", withUnicode);
        var fields = BridgeProtocol.DecodeFields(serialized);
        Assert.Equal(new[] { "1", "runtime_setting", "TranscriptCompare", "compare_script", withUnicode }, fields);
    }

    [Fact]
    public void SendWritesOrderedImmutableCommandFiles()
    {
        var temp = Path.Combine(Path.GetTempPath(), "narration-utils-bridge-tests-" + Guid.NewGuid());
        try
        {
            var bridge = new BridgeClient(temp);
            var first = bridge.Send("first", "a");
            var second = bridge.Send("second", "b");
            Assert.Equal("00000000.cmd", Path.GetFileName(first));
            Assert.Equal("00000001.cmd", Path.GetFileName(second));
            Assert.Equal("first", BridgeProtocol.DecodeFields(File.ReadAllText(first))[1]);
        }
        finally { Directory.Delete(temp, recursive: true); }
    }

    [Fact]
    public void SendWritesNoByteOrderMark()
    {
        // narration_ui_bridge.lua reads the command file with io.open(path, "r") and
        // checks that the very first byte is the literal digit '1' (the protocol
        // version). A UTF-8 BOM preamble on this file corrupts that check and makes
        // the Lua adapter reject every command with "Unsupported hub protocol".
        var temp = Path.Combine(Path.GetTempPath(), "narration-utils-bridge-tests-" + Guid.NewGuid());
        try
        {
            var bridge = new BridgeClient(temp);
            var path = bridge.Send("prepare_compare", "run-1");
            var bytes = File.ReadAllBytes(path);
            Assert.Equal((byte)'1', bytes[0]);
        }
        finally { Directory.Delete(temp, recursive: true); }
    }

    [Fact]
    public void ReadEventsTailsNewLinesOnceAndDecodesPercentEncoding()
    {
        var temp = Path.Combine(Path.GetTempPath(), "narration-utils-bridge-tests-" + Guid.NewGuid());
        Directory.CreateDirectory(temp);
        try
        {
            var eventsPath = Path.Combine(temp, "events.log");
            File.WriteAllText(eventsPath, "COMPARE_PREPARED|run%7C1|C%3A%5Cmanifest.txt\n");
            var bridge = new BridgeClient(temp);
            var events = bridge.ReadEvents();
            Assert.Equal(new[] { "COMPARE_PREPARED|run%7C1|C%3A%5Cmanifest.txt" }, events);
            Assert.Equal(new[] { "COMPARE_PREPARED", "run|1", @"C:\manifest.txt" }, BridgeProtocol.DecodeFields(events[0]));
            Assert.Empty(bridge.ReadEvents());
        }
        finally { Directory.Delete(temp, recursive: true); }
    }
}
