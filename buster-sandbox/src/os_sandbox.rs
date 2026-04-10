//! OS-level process sandboxing.
//!
//! Provides an additional layer of defense beyond the application-level allowlist
//! by using the operating system's native sandboxing facilities:
//!
//! - **macOS**: Apple's Seatbelt (`sandbox-exec`) with a generated profile
//! - **Linux**: seccomp-bpf syscall filtering (stub — requires the `seccomp` crate)
//!
//! These are defense-in-depth: even if a sandboxed process is compromised, the OS
//! kernel enforces the restrictions.

use std::path::PathBuf;

use crate::error::SandboxError;
use crate::types::Capability;

/// OS-level sandbox configuration for a single process execution.
///
/// Wraps platform-specific sandboxing so the caller can just call `apply()`
/// on a `std::process::Command` before spawning.
pub struct OsSandbox {
    workspace_root: PathBuf,
    allow_network: bool,
    writable_paths: Vec<PathBuf>,
    /// Additional read-only paths from capabilities.
    /// Currently unused on macOS (reads are unrestricted) but will be used
    /// by the Linux seccomp implementation to scope filesystem access.
    #[allow(dead_code)]
    readable_paths: Vec<PathBuf>,
}

impl OsSandbox {
    /// Create a new OS sandbox scoped to the given workspace.
    ///
    /// - `workspace_root`: the root directory that the process is allowed to access.
    /// - `allow_network`: whether outbound network access is permitted.
    pub fn new(workspace_root: PathBuf, allow_network: bool) -> Self {
        Self {
            workspace_root,
            allow_network,
            writable_paths: Vec::new(),
            readable_paths: Vec::new(),
        }
    }

    /// Build an `OsSandbox` from an execution request's capabilities.
    ///
    /// This inspects the capability list to determine network access and
    /// filesystem permissions, then produces the appropriate sandbox config.
    pub fn from_capabilities(workspace_root: PathBuf, capabilities: &[Capability]) -> Self {
        let mut allow_network = false;
        let mut writable_paths = Vec::new();
        let mut readable_paths = Vec::new();

        for cap in capabilities {
            match cap {
                Capability::Network => {
                    allow_network = true;
                }
                Capability::Filesystem(fs) => {
                    if fs.writable {
                        writable_paths.push(fs.path.clone());
                    } else {
                        readable_paths.push(fs.path.clone());
                    }
                }
            }
        }

        Self {
            workspace_root,
            allow_network,
            writable_paths,
            readable_paths,
        }
    }

    /// Apply OS-level sandboxing to a `Command` before it is spawned.
    ///
    /// On macOS this rewrites the command to run under `sandbox-exec`.
    /// On Linux this is currently a no-op stub (seccomp requires an external crate).
    /// On other platforms this is a no-op.
    pub fn apply(&self, cmd: &mut std::process::Command) -> Result<(), SandboxError> {
        self.apply_platform(cmd)
    }

    // ------------------------------------------------------------------ macOS
    #[cfg(target_os = "macos")]
    fn apply_platform(&self, cmd: &mut std::process::Command) -> Result<(), SandboxError> {
        use std::os::unix::process::CommandExt;

        // Generate the Seatbelt profile string
        let profile = self.generate_seatbelt_profile();

        // Apply the sandbox using `sandbox_init` in a pre_exec hook. This
        // runs in the forked child process before exec, so the Seatbelt
        // profile is applied to the child only (not the parent). The profile
        // string is captured by the closure and passed to the C API.
        //
        // SAFETY: `sandbox_init` is async-signal-safe on macOS and is the
        // documented way to apply a sandbox profile to a process. The closure
        // runs after fork() but before exec() in the child process.
        unsafe {
            cmd.pre_exec(move || apply_seatbelt_profile(&profile));
        }

        Ok(())
    }

    #[cfg(target_os = "macos")]
    fn generate_seatbelt_profile(&self) -> String {
        let mut profile = String::new();

        // Resolve the workspace root to its canonical path. On macOS /var is a
        // symlink to /private/var, so TempDir paths like /var/folders/... must
        // be resolved to /private/var/folders/... for the Seatbelt kernel to
        // match them correctly. We emit rules for both the original and
        // canonical forms so either will work.
        let workspace_original = self.workspace_root.to_string_lossy().to_string();
        let workspace_canonical = self
            .workspace_root
            .canonicalize()
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_else(|_| workspace_original.clone());

        // Header: deny everything by default
        profile.push_str("(version 1)\n");
        profile.push_str("(deny default)\n\n");

        // Allow basic process operations
        profile.push_str("; Basic process operations\n");
        profile.push_str("(allow process*)\n");
        profile.push_str("(allow signal)\n\n");

        // Allow system information and IPC (needed for basic process startup)
        profile.push_str("; System information and IPC\n");
        profile.push_str("(allow sysctl*)\n");
        profile.push_str("(allow mach*)\n");
        profile.push_str("(allow ipc*)\n\n");

        // Allow all file reads. Restricting file-read to specific subpaths is
        // impractical on macOS because the dynamic linker, system frameworks,
        // dyld shared cache, and other OS internals read from paths that vary
        // across macOS versions. A too-narrow read policy causes SIGABRT.
        // The real security value is in restricting *writes* and *network*.
        profile.push_str("; File reads: allow globally (write restrictions provide the security boundary)\n");
        profile.push_str("(allow file-read*)\n\n");

        // Allow writing to open file descriptors (stdout, stderr, pipes) and
        // file ioctl (needed for terminal/pipe operations).
        profile.push_str("; Allow writing to open file descriptors (stdout/stderr/pipes)\n");
        profile.push_str("(allow file-write-data)\n");
        profile.push_str("(allow file-ioctl)\n\n");

        // Allow file creation and full write access to the workspace only.
        // file-write* includes file-write-create, file-write-unlink,
        // file-write-mode, file-write-owner, file-write-flags, etc.
        // file-write-data (allowed globally above) only covers writing to
        // already-open fds; file-write-create/unlink/etc. require subpath rules.
        profile.push_str("; Workspace write access (create, delete, rename, chmod, etc.)\n");
        profile.push_str(&format!(
            "(allow file-write* (subpath \"{workspace_canonical}\"))\n"
        ));
        if workspace_original != workspace_canonical {
            profile.push_str(&format!(
                "(allow file-write* (subpath \"{workspace_original}\"))\n"
            ));
        }
        profile.push('\n');

        // Allow writes to temp directories.
        // On macOS, /tmp -> /private/tmp and TMPDIR is under /var/folders ->
        // /private/var/folders, so we include both forms.
        profile.push_str("; Temp directory write access\n");
        profile.push_str("(allow file-write* (subpath \"/tmp\"))\n");
        profile.push_str("(allow file-write* (subpath \"/private/tmp\"))\n");
        if let Ok(tmpdir) = std::env::var("TMPDIR") {
            let tmpdir_trimmed = tmpdir.trim_end_matches('/');
            profile.push_str(&format!(
                "(allow file-write* (subpath \"{tmpdir_trimmed}\"))\n"
            ));
            // Also emit the canonical form of TMPDIR
            if let Ok(canonical) = std::fs::canonicalize(&tmpdir) {
                let canonical_str = canonical.to_string_lossy();
                if canonical_str.as_ref() != tmpdir_trimmed {
                    profile.push_str(&format!(
                        "(allow file-write* (subpath \"{canonical_str}\"))\n"
                    ));
                }
            }
        }
        profile.push('\n');

        // Additional explicitly granted writable paths from capabilities
        if !self.writable_paths.is_empty() {
            profile.push_str("; Additional writable paths from capabilities\n");
            for path in &self.writable_paths {
                let p = path.to_string_lossy();
                profile.push_str(&format!("(allow file-write* (subpath \"{p}\"))\n"));
                // Also allow the canonical form
                if let Ok(canonical) = path.canonicalize() {
                    let c = canonical.to_string_lossy();
                    if c.as_ref() != p.as_ref() {
                        profile
                            .push_str(&format!("(allow file-write* (subpath \"{c}\"))\n"));
                    }
                }
            }
            profile.push('\n');
        }

        // Network access
        if self.allow_network {
            profile.push_str("; Network access (granted by capability)\n");
            profile.push_str("(allow network*)\n");
        } else {
            profile.push_str("; Network access denied\n");
            // Allow local/loopback only (some tools need it for IPC)
            profile.push_str("(allow network* (local ip))\n");
            profile.push_str("(allow network* (remote ip \"localhost:*\"))\n");
        }

        profile
    }

    // ----------------------------------------------------------------- Linux
    #[cfg(target_os = "linux")]
    fn apply_platform(&self, _cmd: &mut std::process::Command) -> Result<(), SandboxError> {
        // seccomp-bpf requires either the `seccomp` crate or raw BPF filter
        // construction via prctl(PR_SET_SECCOMP, ...). This is left as a stub
        // because adding the `seccomp` crate as a dependency requires updating
        // Cargo.toml. We log a warning so operators know the OS-level sandbox
        // is not active on Linux.
        //
        // A full implementation would:
        // 1. Build a BPF filter allowing: read, write, open, openat, close,
        //    fstat, lstat, stat, lseek, mmap, mprotect, munmap, brk, ioctl,
        //    access, pipe, select, poll, dup, dup2, socket (if network allowed),
        //    connect, sendto, recvfrom, clone, fork, vfork, execve, exit,
        //    exit_group, wait4, kill, getpid, getuid, etc.
        // 2. Block dangerous syscalls: ptrace, mount, umount, reboot,
        //    swapon, swapoff, init_module, finit_module, delete_module,
        //    pivot_root, chroot, kexec_load, etc.
        // 3. Use prctl(PR_SET_NO_NEW_PRIVS, 1) to prevent privilege escalation.
        // 4. Apply the filter via prctl(PR_SET_SECCOMP, SECCOMP_MODE_FILTER, &prog).
        //
        // This would be done in a pre_exec closure on the Command.
        eprintln!(
            "buster-sandbox: OS-level sandboxing (seccomp-bpf) is not yet implemented on Linux. \
             The process will run without kernel-level restrictions. \
             Application-level allowlist enforcement is still active."
        );
        Ok(())
    }

    // ----------------------------------------------------- Other platforms
    #[cfg(not(any(target_os = "macos", target_os = "linux")))]
    fn apply_platform(&self, _cmd: &mut std::process::Command) -> Result<(), SandboxError> {
        eprintln!(
            "buster-sandbox: OS-level sandboxing is not supported on this platform. \
             The process will run without kernel-level restrictions. \
             Application-level allowlist enforcement is still active."
        );
        Ok(())
    }
}

// --------------------------------------------------------------------------
// macOS Seatbelt FFI
// --------------------------------------------------------------------------

/// Apply a Seatbelt profile string to the current process using the
/// `sandbox_init` C API.
///
/// This must be called in a forked child before exec (i.e., inside a
/// `pre_exec` closure). Once applied the profile cannot be removed.
#[cfg(target_os = "macos")]
fn apply_seatbelt_profile(profile: &str) -> Result<(), std::io::Error> {
    use std::ffi::CString;

    extern "C" {
        /// int sandbox_init(const char *profile, uint64_t flags, char **errorbuf);
        fn sandbox_init(
            profile: *const std::ffi::c_char,
            flags: u64,
            errorbuf: *mut *mut std::ffi::c_char,
        ) -> std::ffi::c_int;

        /// void sandbox_free_error(char *errorbuf);
        fn sandbox_free_error(errorbuf: *mut std::ffi::c_char);
    }

    let c_profile = CString::new(profile).map_err(|e| {
        std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            format!("Seatbelt profile contains null byte: {e}"),
        )
    })?;

    let mut errorbuf: *mut std::ffi::c_char = std::ptr::null_mut();

    // flags = 0 means the first argument is a profile string (not a named profile)
    let ret = unsafe { sandbox_init(c_profile.as_ptr(), 0, &mut errorbuf) };

    if ret != 0 {
        let err_msg = if !errorbuf.is_null() {
            let msg = unsafe { std::ffi::CStr::from_ptr(errorbuf) }
                .to_string_lossy()
                .into_owned();
            unsafe { sandbox_free_error(errorbuf) };
            msg
        } else {
            "unknown error".to_string()
        };

        return Err(std::io::Error::new(
            std::io::ErrorKind::PermissionDenied,
            format!("sandbox_init failed: {err_msg}"),
        ));
    }

    Ok(())
}

// --------------------------------------------------------------------------
// Tests
// --------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn test_new_defaults() {
        let sandbox = OsSandbox::new(PathBuf::from("/tmp/workspace"), false);
        assert_eq!(sandbox.workspace_root, PathBuf::from("/tmp/workspace"));
        assert!(!sandbox.allow_network);
        assert!(sandbox.writable_paths.is_empty());
        assert!(sandbox.readable_paths.is_empty());
    }

    #[test]
    fn test_new_with_network() {
        let sandbox = OsSandbox::new(PathBuf::from("/tmp/workspace"), true);
        assert!(sandbox.allow_network);
    }

    #[test]
    fn test_from_capabilities_empty() {
        let sandbox = OsSandbox::from_capabilities(PathBuf::from("/tmp/ws"), &[]);
        assert!(!sandbox.allow_network);
        assert!(sandbox.writable_paths.is_empty());
        assert!(sandbox.readable_paths.is_empty());
    }

    #[test]
    fn test_from_capabilities_network() {
        use crate::types::Capability;

        let caps = vec![Capability::Network];
        let sandbox = OsSandbox::from_capabilities(PathBuf::from("/tmp/ws"), &caps);
        assert!(sandbox.allow_network);
    }

    #[test]
    fn test_from_capabilities_filesystem() {
        use crate::types::{Capability, FsAccess};

        let caps = vec![
            Capability::Filesystem(FsAccess {
                path: PathBuf::from("/data/readonly"),
                writable: false,
            }),
            Capability::Filesystem(FsAccess {
                path: PathBuf::from("/data/readwrite"),
                writable: true,
            }),
        ];
        let sandbox = OsSandbox::from_capabilities(PathBuf::from("/tmp/ws"), &caps);
        assert!(!sandbox.allow_network);
        assert_eq!(sandbox.readable_paths, vec![PathBuf::from("/data/readonly")]);
        assert_eq!(
            sandbox.writable_paths,
            vec![PathBuf::from("/data/readwrite")]
        );
    }

    #[cfg(target_os = "macos")]
    mod macos_tests {
        use super::*;

        #[test]
        fn test_seatbelt_profile_denies_by_default() {
            let sandbox = OsSandbox::new(PathBuf::from("/tmp/workspace"), false);
            let profile = sandbox.generate_seatbelt_profile();

            assert!(profile.contains("(version 1)"));
            assert!(profile.contains("(deny default)"));
        }

        #[test]
        fn test_seatbelt_profile_workspace_write_access() {
            // Use a real temp dir so canonicalize works
            let dir = std::env::temp_dir().join("buster_test_ws");
            let _ = std::fs::create_dir_all(&dir);
            let canonical = dir.canonicalize().unwrap_or_else(|_| dir.clone());
            let sandbox = OsSandbox::new(dir.clone(), false);
            let profile = sandbox.generate_seatbelt_profile();

            let canonical_str = canonical.to_string_lossy();
            // Reads are allowed globally; writes are restricted to workspace
            assert!(
                profile.contains(&format!("(allow file-write* (subpath \"{canonical_str}\"))")),
                "profile should contain canonical workspace write rule, got:\n{profile}"
            );
            let _ = std::fs::remove_dir(&dir);
        }

        #[test]
        fn test_seatbelt_profile_allows_all_reads() {
            let sandbox = OsSandbox::new(PathBuf::from("/tmp/workspace"), false);
            let profile = sandbox.generate_seatbelt_profile();

            // The profile uses a blanket file-read* allow because restricting
            // reads to specific subpaths breaks process startup on macOS.
            assert!(profile.contains("(allow file-read*)"));
        }

        #[test]
        fn test_seatbelt_profile_allows_write_data_and_ioctl() {
            let sandbox = OsSandbox::new(PathBuf::from("/tmp/workspace"), false);
            let profile = sandbox.generate_seatbelt_profile();

            // Needed for stdout/stderr/pipe writes
            assert!(profile.contains("(allow file-write-data)"));
            assert!(profile.contains("(allow file-ioctl)"));
        }

        #[test]
        fn test_seatbelt_profile_network_denied() {
            let sandbox = OsSandbox::new(PathBuf::from("/tmp/workspace"), false);
            let profile = sandbox.generate_seatbelt_profile();

            // Should NOT have a blanket network allow -- the profile should
            // only contain qualified network rules for local/loopback.
            // Check that "(allow network*)" is followed by a filter, not bare.
            assert!(
                !profile.contains("(allow network*)\n"),
                "profile should not contain a bare blanket network allow"
            );
            // Should allow local only
            assert!(profile.contains("(allow network* (local ip))"));
        }

        #[test]
        fn test_seatbelt_profile_network_allowed() {
            let sandbox = OsSandbox::new(PathBuf::from("/tmp/workspace"), true);
            let profile = sandbox.generate_seatbelt_profile();

            assert!(profile.contains("(allow network*)\n"));
        }

        #[test]
        fn test_seatbelt_profile_additional_writable_paths() {
            let mut sandbox = OsSandbox::new(PathBuf::from("/tmp/workspace"), false);
            sandbox.writable_paths.push(PathBuf::from("/extra/write"));

            let profile = sandbox.generate_seatbelt_profile();

            assert!(profile.contains("(allow file-write* (subpath \"/extra/write\"))"));
        }

        #[test]
        fn test_apply_creates_pre_exec_hook() {
            // We can't easily test that pre_exec was set, but we can verify
            // that apply() succeeds without error on a fresh Command.
            let sandbox = OsSandbox::new(PathBuf::from("/tmp"), false);
            let mut cmd = std::process::Command::new("/usr/bin/true");
            let result = sandbox.apply(&mut cmd);
            assert!(result.is_ok());
        }
    }
}
