use argon2::password_hash::{
    rand_core::OsRng, PasswordHash, PasswordHasher, PasswordVerifier, SaltString,
};
use argon2::{Algorithm, Argon2, Params, Version};
use rand::Rng;
use sha2::{Digest, Sha256};
use std::sync::OnceLock;

const PASSWORD_CHARS: &[u8] = b"ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";

pub fn hash_password(password: &str) -> Result<String, argon2::password_hash::Error> {
    let salt = SaltString::generate(&mut OsRng);
    Ok(argon2()
        .hash_password(password.as_bytes(), &salt)?
        .to_string())
}

pub fn verify_password(password: &str, hash: &str) -> bool {
    let Ok(parsed) = PasswordHash::new(hash) else {
        return false;
    };
    argon2()
        .verify_password(password.as_bytes(), &parsed)
        .is_ok()
}

pub fn dummy_password_hash() -> &'static str {
    static HASH: OnceLock<String> = OnceLock::new();
    HASH.get_or_init(|| hash_password("mnote-timing-dummy").expect("dummy hash"))
}

pub fn needs_rehash(hash: &str) -> bool {
    let Ok(parsed) = PasswordHash::new(hash) else {
        return true;
    };
    let Ok(params) = Params::try_from(&parsed) else {
        return true;
    };
    let (m, t, p) = target_params();
    params.m_cost() < m || params.t_cost() < t || params.p_cost() < p
}

pub fn generate_password() -> String {
    let mut rng = rand::thread_rng();
    (0..20)
        .map(|_| {
            let idx = rng.gen_range(0..PASSWORD_CHARS.len());
            PASSWORD_CHARS[idx] as char
        })
        .collect()
}

pub fn random_token() -> String {
    let bytes: [u8; 32] = rand::thread_rng().gen();
    hex::encode(bytes)
}

pub fn hash_token(token: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(token.as_bytes());
    hex::encode(hasher.finalize())
}

pub fn secrets_equal(a: &str, b: &str) -> bool {
    let a = a.as_bytes();
    let b = b.as_bytes();
    let len = a.len().max(b.len());
    let mut diff = a.len() ^ b.len();
    for i in 0..len {
        let x = a.get(i).copied().unwrap_or(0);
        let y = b.get(i).copied().unwrap_or(0);
        diff |= usize::from(x ^ y);
    }
    diff == 0
}

pub fn valid_username(username: &str) -> bool {
    let len = username.len();
    (1..=32).contains(&len)
        && username
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
}

fn target_params() -> (u32, u32, u32) {
    #[cfg(debug_assertions)]
    {
        (4096, 1, 1)
    }
    #[cfg(not(debug_assertions))]
    {
        (19456, 2, 1)
    }
}

fn argon2() -> Argon2<'static> {
    let (m, t, p) = target_params();
    let params = Params::new(m, t, p, None).expect("argon2 params");
    Argon2::new(Algorithm::Argon2id, Version::V0x13, params)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn password_roundtrip() {
        let hash = hash_password("secret-pass").unwrap();
        assert!(verify_password("secret-pass", &hash));
        assert!(!verify_password("wrong", &hash));
    }

    #[test]
    fn invalid_hash_fails() {
        assert!(!verify_password("x", "not-a-hash"));
    }

    #[test]
    fn generated_password_length() {
        let p = generate_password();
        assert_eq!(p.len(), 20);
        assert!(p.chars().all(|c| PASSWORD_CHARS.contains(&(c as u8))));
    }

    #[test]
    fn secrets_match_only_when_equal() {
        assert!(secrets_equal("abc", "abc"));
        assert!(!secrets_equal("abc", "abd"));
        assert!(!secrets_equal("abc", "ab"));
        assert!(!secrets_equal("", "x"));
    }

    #[test]
    fn token_hash_is_stable() {
        let t = random_token();
        assert_eq!(t.len(), 64);
        assert_eq!(hash_token(&t), hash_token(&t));
        assert_ne!(hash_token(&t), hash_token("other"));
    }

    #[test]
    fn username_rules() {
        assert!(valid_username("alice"));
        assert!(valid_username("a_b-1"));
        assert!(!valid_username(""));
        assert!(!valid_username("has space"));
        assert!(!valid_username("bad!"));
        assert!(!valid_username(&"a".repeat(33)));
    }
}
