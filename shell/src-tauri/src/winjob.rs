//! Windows Job Objects are what actually guarantee the Python child dies
//! with this process - a plain parent/child relationship on Windows does
//! not kill children automatically, whether this process exits cleanly or
//! crashes. `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE` makes the OS terminate
//! every process assigned to the job as soon as the job's last handle
//! closes, which happens implicitly when this process terminates for any
//! reason - no cleanup code of ours needs to run for that to happen.

use std::os::windows::io::AsRawHandle;
use std::process::Child;

use windows::Win32::Foundation::HANDLE;
use windows::Win32::System::JobObjects::{
    AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
    SetInformationJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
};

/// Assigns `child` to a fresh job object configured to kill-on-close. The
/// job handle is deliberately leaked: it must outlive this function and
/// there is nothing meaningful to do with it afterward - the OS reclaims it
/// when this process exits, which is exactly the moment its effect matters.
pub fn bind_to_job_object(child: &Child) {
    unsafe {
        let job = match CreateJobObjectW(None, windows::core::PCWSTR::null()) {
            Ok(handle) => handle,
            Err(err) => {
                eprintln!("Narration Utils shell: could not create job object: {err}");
                return;
            }
        };

        let mut info = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
        info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;

        let result: windows::core::Result<()> = SetInformationJobObject(
            job,
            JobObjectExtendedLimitInformation,
            &info as *const _ as *const std::ffi::c_void,
            std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
        );
        if let Err(err) = result {
            eprintln!("Narration Utils shell: could not configure job object: {err}");
            return;
        }

        let process_handle = HANDLE(child.as_raw_handle());
        let assign_result: windows::core::Result<()> = AssignProcessToJobObject(job, process_handle);
        if let Err(err) = assign_result {
            eprintln!("Narration Utils shell: could not assign backend process to job object: {err}");
        }
    }
}
