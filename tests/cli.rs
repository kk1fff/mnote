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

#[test]
fn warns_when_data_is_web_subdir() {
    let root = tempdir().unwrap();
    let real = root.path().join("data");
    bin()
        .args(["--data", real.to_str().unwrap(), "user", "add", "alice"])
        .assert()
        .success();

    let web_data = root.path().join("web").join("data");
    bin()
        .args(["--data", web_data.to_str().unwrap(), "user", "add", "bob"])
        .assert()
        .success()
        .stderr(predicate::str::contains("cwd-relative"))
        .stderr(predicate::str::contains(real.to_str().unwrap()));
}
