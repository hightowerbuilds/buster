use std::collections::HashMap;
use std::path::Path;
use serde::{Deserialize, Serialize};

/// A single entry in a known_hosts file.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct KnownHost {
    /// Hostname (or IP address).
    pub hostname: String,
    /// Key type (e.g. "ssh-rsa", "ssh-ed25519", "ecdsa-sha2-nistp256").
    pub key_type: String,
    /// Base64-encoded public key data.
    pub public_key_base64: String,
}

/// Result of verifying a host key against known hosts.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum HostKeyResult {
    /// The host key matches a known entry.
    Trusted,
    /// The hostname has no entry in known hosts.
    Unknown,
    /// The hostname exists but with a different key (possible MITM).
    Mismatch {
        expected_key_type: String,
        expected_key: String,
    },
}

/// Manages known SSH host keys, supporting the standard OpenSSH
/// `known_hosts` file format.
///
/// File format (one entry per line):
/// ```text
/// hostname key_type base64_key
/// ```
///
/// Lines starting with `#` or empty lines are ignored during parsing.
pub struct HostKeyVerifier {
    /// Entries indexed by hostname for fast lookup.
    hosts: HashMap<String, KnownHost>,
}

impl HostKeyVerifier {
    /// Create an empty verifier.
    pub fn new() -> Self {
        Self {
            hosts: HashMap::new(),
        }
    }

    /// Load known hosts from a file path.
    ///
    /// Parses the standard OpenSSH `known_hosts` format:
    /// `hostname key_type base64_key`
    ///
    /// Lines starting with `#` or that don't have exactly 3 fields are
    /// silently skipped.
    pub fn load(path: &Path) -> Self {
        let content = match std::fs::read_to_string(path) {
            Ok(c) => c,
            Err(_) => return Self::new(),
        };
        Self::parse(&content)
    }

    /// Parse known hosts from a string (the file contents).
    pub fn parse(content: &str) -> Self {
        let mut hosts = HashMap::new();

        for line in content.lines() {
            let line = line.trim();
            if line.is_empty() || line.starts_with('#') {
                continue;
            }

            let parts: Vec<&str> = line.splitn(3, ' ').collect();
            if parts.len() != 3 {
                continue;
            }

            let hostname = parts[0].to_string();
            let key_type = parts[1].to_string();
            let public_key_base64 = parts[2].to_string();

            hosts.insert(
                hostname.clone(),
                KnownHost {
                    hostname,
                    key_type,
                    public_key_base64,
                },
            );
        }

        Self { hosts }
    }

    /// Write known hosts to a file in OpenSSH `known_hosts` format.
    pub fn save(&self, path: &Path) -> std::io::Result<()> {
        let content = self.serialize();
        std::fs::write(path, content)
    }

    /// Serialize all entries to the OpenSSH `known_hosts` format string.
    pub fn serialize(&self) -> String {
        let mut lines: Vec<String> = self
            .hosts
            .values()
            .map(|h| format!("{} {} {}", h.hostname, h.key_type, h.public_key_base64))
            .collect();
        // Sort for deterministic output.
        lines.sort();
        if lines.is_empty() {
            String::new()
        } else {
            let mut out = lines.join("\n");
            out.push('\n');
            out
        }
    }

    /// Verify a host's key against the known hosts.
    pub fn verify(&self, hostname: &str, key_type: &str, key_data: &str) -> HostKeyResult {
        match self.hosts.get(hostname) {
            None => HostKeyResult::Unknown,
            Some(known) => {
                if known.key_type == key_type && known.public_key_base64 == key_data {
                    HostKeyResult::Trusted
                } else {
                    HostKeyResult::Mismatch {
                        expected_key_type: known.key_type.clone(),
                        expected_key: known.public_key_base64.clone(),
                    }
                }
            }
        }
    }

    /// Add or update a host key entry.
    pub fn add(&mut self, hostname: &str, key_type: &str, key_data: &str) {
        self.hosts.insert(
            hostname.to_string(),
            KnownHost {
                hostname: hostname.to_string(),
                key_type: key_type.to_string(),
                public_key_base64: key_data.to_string(),
            },
        );
    }

    /// Remove a host from known hosts. Returns `true` if it was present.
    pub fn remove(&mut self, hostname: &str) -> bool {
        self.hosts.remove(hostname).is_some()
    }

    /// Get the known host entry for a hostname, if any.
    pub fn get(&self, hostname: &str) -> Option<&KnownHost> {
        self.hosts.get(hostname)
    }

    /// Number of known hosts.
    pub fn count(&self) -> usize {
        self.hosts.len()
    }
}

impl Default for HostKeyVerifier {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    const SAMPLE_KNOWN_HOSTS: &str = "\
# This is a comment
dev.example.com ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIExampleKeyData1234567890abcdef
prod.example.com ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABgQDexample+key+data==
192.168.1.100 ecdsa-sha2-nistp256 AAAAE2VjZHNhLXNoYTItbmlzdHAyNTYexample
";

    #[test]
    fn test_parse_known_hosts() {
        let verifier = HostKeyVerifier::parse(SAMPLE_KNOWN_HOSTS);
        assert_eq!(verifier.count(), 3);

        let dev = verifier.get("dev.example.com").unwrap();
        assert_eq!(dev.key_type, "ssh-ed25519");
        assert_eq!(
            dev.public_key_base64,
            "AAAAC3NzaC1lZDI1NTE5AAAAIExampleKeyData1234567890abcdef"
        );
    }

    #[test]
    fn test_verify_trusted() {
        let verifier = HostKeyVerifier::parse(SAMPLE_KNOWN_HOSTS);
        let result = verifier.verify(
            "dev.example.com",
            "ssh-ed25519",
            "AAAAC3NzaC1lZDI1NTE5AAAAIExampleKeyData1234567890abcdef",
        );
        assert_eq!(result, HostKeyResult::Trusted);
    }

    #[test]
    fn test_verify_unknown() {
        let verifier = HostKeyVerifier::parse(SAMPLE_KNOWN_HOSTS);
        let result = verifier.verify("unknown.example.com", "ssh-ed25519", "somekey");
        assert_eq!(result, HostKeyResult::Unknown);
    }

    #[test]
    fn test_verify_mismatch_key_data() {
        let verifier = HostKeyVerifier::parse(SAMPLE_KNOWN_HOSTS);
        let result = verifier.verify(
            "dev.example.com",
            "ssh-ed25519",
            "AAAAC3NzaC1lZDI1NTE5DIFFERENT_KEY_HERE",
        );
        assert_eq!(
            result,
            HostKeyResult::Mismatch {
                expected_key_type: "ssh-ed25519".to_string(),
                expected_key: "AAAAC3NzaC1lZDI1NTE5AAAAIExampleKeyData1234567890abcdef"
                    .to_string(),
            }
        );
    }

    #[test]
    fn test_verify_mismatch_key_type() {
        let verifier = HostKeyVerifier::parse(SAMPLE_KNOWN_HOSTS);
        // Same host, different key type entirely.
        let result = verifier.verify(
            "dev.example.com",
            "ssh-rsa",
            "AAAAB3NzaC1yc2ECOMPLETELY_DIFFERENT",
        );
        assert!(matches!(result, HostKeyResult::Mismatch { .. }));
    }

    #[test]
    fn test_add_and_verify() {
        let mut verifier = HostKeyVerifier::new();
        verifier.add("myhost.com", "ssh-ed25519", "AAAA_MY_KEY_DATA");

        let result = verifier.verify("myhost.com", "ssh-ed25519", "AAAA_MY_KEY_DATA");
        assert_eq!(result, HostKeyResult::Trusted);
        assert_eq!(verifier.count(), 1);
    }

    #[test]
    fn test_remove_host() {
        let mut verifier = HostKeyVerifier::parse(SAMPLE_KNOWN_HOSTS);
        assert_eq!(verifier.count(), 3);

        assert!(verifier.remove("dev.example.com"));
        assert_eq!(verifier.count(), 2);

        let result = verifier.verify("dev.example.com", "ssh-ed25519", "whatever");
        assert_eq!(result, HostKeyResult::Unknown);

        // Removing again returns false.
        assert!(!verifier.remove("dev.example.com"));
    }

    #[test]
    fn test_serialize_round_trip() {
        let verifier = HostKeyVerifier::parse(SAMPLE_KNOWN_HOSTS);
        let serialized = verifier.serialize();

        // Re-parse.
        let verifier2 = HostKeyVerifier::parse(&serialized);
        assert_eq!(verifier2.count(), verifier.count());

        // Verify all entries survived.
        for host in verifier.hosts.values() {
            let result =
                verifier2.verify(&host.hostname, &host.key_type, &host.public_key_base64);
            assert_eq!(result, HostKeyResult::Trusted);
        }
    }

    #[test]
    fn test_load_and_save() {
        let dir = std::env::temp_dir().join("buster_remote_test_host_keys");
        let _ = std::fs::create_dir_all(&dir);
        let path = dir.join("known_hosts_test");

        // Write sample file.
        {
            let mut f = std::fs::File::create(&path).unwrap();
            f.write_all(SAMPLE_KNOWN_HOSTS.as_bytes()).unwrap();
        }

        // Load and verify.
        let verifier = HostKeyVerifier::load(&path);
        assert_eq!(verifier.count(), 3);

        // Modify and save.
        let mut verifier = verifier;
        verifier.add("new.host.com", "ssh-ed25519", "NEWKEYDATA");
        verifier.save(&path).unwrap();

        // Reload and check.
        let verifier2 = HostKeyVerifier::load(&path);
        assert_eq!(verifier2.count(), 4);
        assert_eq!(
            verifier2.verify("new.host.com", "ssh-ed25519", "NEWKEYDATA"),
            HostKeyResult::Trusted
        );

        // Cleanup.
        let _ = std::fs::remove_file(&path);
        let _ = std::fs::remove_dir(&dir);
    }

    #[test]
    fn test_load_nonexistent_file() {
        let verifier = HostKeyVerifier::load(Path::new("/nonexistent/path/known_hosts"));
        assert_eq!(verifier.count(), 0);
    }

    #[test]
    fn test_parse_empty_and_comment_lines() {
        let content = "\
# comment only

# another comment
dev.example.com ssh-ed25519 KEY_DATA

";
        let verifier = HostKeyVerifier::parse(content);
        assert_eq!(verifier.count(), 1);
    }

    #[test]
    fn test_parse_malformed_lines_skipped() {
        let content = "\
hostname_only
dev.example.com ssh-ed25519 KEY_DATA
just two_fields
";
        let verifier = HostKeyVerifier::parse(content);
        // Only the valid line should be parsed.
        assert_eq!(verifier.count(), 1);
        assert!(verifier.get("dev.example.com").is_some());
    }

    #[test]
    fn test_update_existing_host() {
        let mut verifier = HostKeyVerifier::new();
        verifier.add("host.com", "ssh-rsa", "OLD_KEY");
        verifier.add("host.com", "ssh-ed25519", "NEW_KEY");

        // Should have updated in place.
        assert_eq!(verifier.count(), 1);
        let result = verifier.verify("host.com", "ssh-ed25519", "NEW_KEY");
        assert_eq!(result, HostKeyResult::Trusted);
    }
}
