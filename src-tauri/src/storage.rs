//! Durable replacement: never truncate the writer's last saved copy.
use std::{fs, io::{self, Write}, path::Path};

pub fn write(path: &Path, bytes: &[u8], must_exist: bool) -> io::Result<()> {
    // Follow existing symlinks so saving through a shortcut preserves the link.
    let target = match fs::canonicalize(path) {
        Ok(target) => target,
        Err(error) if error.kind() == io::ErrorKind::NotFound && !must_exist => {
            if fs::symlink_metadata(path).is_ok() {
                return Err(io::Error::new(io::ErrorKind::NotFound, "The file's symlink target is missing"));
            }
            path.to_owned()
        }
        Err(error) => return Err(error),
    };
    let metadata = match fs::metadata(&target) {
        Ok(metadata) => {
            if !metadata.is_file() || metadata.permissions().readonly() {
                return Err(io::Error::new(io::ErrorKind::PermissionDenied, "The destination is not a writable file"));
            }
            // Atomic rename must not bypass the existing file's access permissions.
            fs::OpenOptions::new().write(true).open(&target)?;
            Some(metadata)
        }
        Err(error) if error.kind() == io::ErrorKind::NotFound && !must_exist => None,
        Err(error) => return Err(error),
    };
    let parent = target.parent().filter(|p| !p.as_os_str().is_empty()).unwrap_or(Path::new("."));
    let mut temporary = tempfile::NamedTempFile::new_in(parent)?;
    temporary.write_all(bytes)?;
    if let Some(metadata) = metadata {
        temporary.as_file().set_permissions(metadata.permissions())?;
    }
    temporary.as_file().sync_all()?;
    temporary.persist(&target).map_err(|error| error.error)?;
    #[cfg(unix)]
    fs::File::open(parent)?.sync_all()?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn replaces_complete_unicode_document_and_rejects_missing_required_file() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("note.md");
        assert!(write(&path, b"new", true).is_err());
        write(&path, b"old", false).unwrap();
        write(&path, "déjà 📝\n".as_bytes(), true).unwrap();
        assert_eq!(fs::read_to_string(&path).unwrap(), "déjà 📝\n");
        assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 1);
    }

    #[cfg(unix)]
    #[test]
    fn preserves_symlink_permissions_and_original_on_readonly_failure() {
        use std::os::unix::fs::{symlink, PermissionsExt};
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("note.md");
        let link = dir.path().join("link.md");
        fs::write(&path, "old").unwrap();
        fs::set_permissions(&path, fs::Permissions::from_mode(0o640)).unwrap();
        symlink(&path, &link).unwrap();
        write(&link, b"new", true).unwrap();
        assert!(fs::symlink_metadata(&link).unwrap().file_type().is_symlink());
        assert_eq!(fs::metadata(&path).unwrap().permissions().mode() & 0o777, 0o640);
        fs::set_permissions(&path, fs::Permissions::from_mode(0o440)).unwrap();
        assert!(write(&link, b"lost", true).is_err());
        assert_eq!(fs::read_to_string(&path).unwrap(), "new");
    }
}
