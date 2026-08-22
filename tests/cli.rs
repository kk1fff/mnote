use assert_cmd::Command;
use predicates::prelude::*;
use tempfile::tempdir;

fn bin() -> Command {
    Command::cargo_bin("mnote").unwrap()
}

#[test]
fn user_add_list_reset() {
    let dir = tempdir().unwrap();
    let data = dir.path();

    bin()
        .args([
            "--data",
            data.to_str().unwrap(),
            "user",
            "add",
            "alice",
            "--password",
            "password1",
        ])
        .assert()
        .success()
        .stdout(predicate::str::contains("Created account 'alice'"))
        .stdout(predicate::str::contains("Temporary password:"))
        .stdout(predicate::str::contains("first login"));

    bin()
        .args(["--data", data.to_str().unwrap(), "user", "add", "alice"])
        .assert()
        .failure();

    bin()
        .args(["--data", data.to_str().unwrap(), "user", "list"])
        .assert()
        .success()
        .stdout(predicate::str::contains("alice"))
        .stdout(predicate::str::contains("set password on next login"));

    bin()
        .args([
            "--data",
            data.to_str().unwrap(),
            "user",
            "reset-password",
            "alice",
        ])
        .assert()
        .success()
        .stdout(predicate::str::contains("Temporary password:"))
        .stdout(predicate::str::contains("first login"));

    bin()
        .args([
            "--data",
            data.to_str().unwrap(),
            "user",
            "reset-password",
            "missing",
        ])
        .assert()
        .failure();
}

#[test]
fn generated_password_on_add() {
    let dir = tempdir().unwrap();
    bin()
        .args(["--data", dir.path().to_str().unwrap(), "user", "add", "bob"])
        .assert()
        .success()
        .stdout(predicate::str::contains("Temporary password:"));
}
