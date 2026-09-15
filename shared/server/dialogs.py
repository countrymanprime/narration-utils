"""Native file-open dialogs, replacing shared/hub/StaDialog.cs + Photino's
ShowOpenFile now that there's no native window to own a dialog.

tkinter's filedialog isn't safe to call concurrently across threads any more
than Win32/COM dialogs were - so this runs each call on its own dedicated
thread with its own Tk root, mirroring StaDialog.Run's one-thread-per-call
shape, just for Tk instead of STA/COM. Works unchanged on Windows/macOS/Linux.
"""

import threading


def show_open_manuscript_dialog(title: str = "Choose manuscript") -> str | None:
    result: dict[str, str | None] = {"path": None}
    error: dict[str, Exception | None] = {"value": None}

    def run():
        import tkinter
        from tkinter import filedialog

        root = tkinter.Tk()
        root.withdraw()
        root.attributes("-topmost", True)
        try:
            path = filedialog.askopenfilename(
                title=title,
                filetypes=[("Supported manuscripts", "*.docx *.md *.markdown *.pdf"), ("Word documents", "*.docx"), ("Markdown", "*.md *.markdown"), ("PDF", "*.pdf")],
                parent=root,
            )
            result["path"] = path or None
        except Exception as exc:  # noqa: BLE001 - re-raised on the caller's thread below
            error["value"] = exc
        finally:
            root.destroy()

    thread = threading.Thread(target=run)
    thread.start()
    thread.join()
    if error["value"] is not None:
        raise error["value"]
    return result["path"]
