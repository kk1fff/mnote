#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Merge {
    pub content: String,
    pub conflict: bool,
}

struct Hunk {
    start: usize,
    end: usize,
    lines: Vec<String>,
}

pub fn three_way(base: &str, local: &str, remote: &str) -> Merge {
    if local == remote {
        return Merge {
            content: local.to_string(),
            conflict: false,
        };
    }
    if local == base {
        return Merge {
            content: remote.to_string(),
            conflict: false,
        };
    }
    if remote == base {
        return Merge {
            content: local.to_string(),
            conflict: false,
        };
    }
    let base_l = split(base);
    let local_l = split(local);
    let remote_l = split(remote);
    let limit = base_l
        .len()
        .saturating_mul(local_l.len().max(remote_l.len()));
    if limit > 1_500_000 {
        return conflict_block(local, remote);
    }
    let hunks_l = replace_hunks(&base_l, &local_l);
    let hunks_r = replace_hunks(&base_l, &remote_l);
    apply_merge(&base_l, &hunks_l, &hunks_r)
}

fn split(s: &str) -> Vec<&str> {
    if s.is_empty() {
        Vec::new()
    } else {
        s.split('\n').collect()
    }
}

fn conflict_block(local: &str, remote: &str) -> Merge {
    Merge {
        content: format!("<<<<<<< this device\n{local}\n=======\n{remote}\n>>>>>>> other device"),
        conflict: true,
    }
}

fn lcs_pairs(a: &[&str], b: &[&str]) -> Vec<(usize, usize)> {
    let n = a.len();
    let m = b.len();
    let mut dp = vec![vec![0u32; m + 1]; n + 1];
    for (i, ai) in a.iter().enumerate() {
        for (j, bj) in b.iter().enumerate() {
            dp[i + 1][j + 1] = if ai == bj {
                dp[i][j] + 1
            } else {
                dp[i + 1][j].max(dp[i][j + 1])
            };
        }
    }
    let mut pairs = Vec::new();
    let mut i = n;
    let mut j = m;
    while i > 0 && j > 0 {
        if a[i - 1] == b[j - 1] {
            pairs.push((i - 1, j - 1));
            i -= 1;
            j -= 1;
        } else if dp[i - 1][j] >= dp[i][j - 1] {
            i -= 1;
        } else {
            j -= 1;
        }
    }
    pairs.reverse();
    pairs
}

fn replace_hunks(old: &[&str], new: &[&str]) -> Vec<Hunk> {
    let mut pairs = vec![(-1isize, -1isize)];
    pairs.extend(
        lcs_pairs(old, new)
            .into_iter()
            .map(|(i, j)| (i as isize, j as isize)),
    );
    pairs.push((old.len() as isize, new.len() as isize));
    let mut hunks = Vec::new();
    for w in pairs.windows(2) {
        let (a0, b0) = w[0];
        let (a1, b1) = w[1];
        let start = (a0 + 1) as usize;
        let end = a1 as usize;
        let new_start = (b0 + 1) as usize;
        let new_end = b1 as usize;
        let old_slice = &old[start..end];
        let new_slice = &new[new_start..new_end];
        if old_slice != new_slice {
            hunks.push(Hunk {
                start,
                end,
                lines: new_slice.iter().map(|s| (*s).to_string()).collect(),
            });
        }
    }
    hunks
}

fn slice_with_hunks(base: &[&str], start: usize, end: usize, hunks: &[Hunk]) -> Vec<String> {
    let mut pos = start;
    let mut out = Vec::new();
    for hunk in hunks {
        if hunk.end <= start || hunk.start >= end {
            continue;
        }
        let h_start = hunk.start.max(start);
        let h_end = hunk.end.min(end);
        out.extend(base[pos..h_start].iter().map(|s| (*s).to_string()));
        if hunk.start >= start && hunk.end <= end {
            out.extend(hunk.lines.iter().cloned());
        } else {
            out.extend(base[h_start..h_end].iter().map(|s| (*s).to_string()));
        }
        pos = h_end;
    }
    out.extend(base[pos..end].iter().map(|s| (*s).to_string()));
    out
}

fn apply_merge(base: &[&str], local: &[Hunk], remote: &[Hunk]) -> Merge {
    let mut i = 0;
    let mut j = 0;
    let mut pos = 0;
    let mut out: Vec<String> = Vec::new();
    let mut conflict = false;
    while i < local.len() || j < remote.len() {
        let ls = local.get(i).map(|h| h.start).unwrap_or(usize::MAX);
        let rs = remote.get(j).map(|h| h.start).unwrap_or(usize::MAX);
        if ls == usize::MAX && rs == usize::MAX {
            break;
        }
        if ls < rs {
            let hunk = &local[i];
            if hunk.end <= pos {
                i += 1;
                continue;
            }
            if remote.get(j).is_some_and(|h| h.start < hunk.end) {
                let (start, end, li, ri) = cluster(local, remote, i, j);
                out.extend(base[pos..start].iter().map(|s| (*s).to_string()));
                let a = slice_with_hunks(base, start, end, &local[i..li]);
                let b = slice_with_hunks(base, start, end, &remote[j..ri]);
                if a == b {
                    out.extend(a);
                } else {
                    conflict = true;
                    out.push("<<<<<<< this device".into());
                    out.extend(a);
                    out.push("=======".into());
                    out.extend(b);
                    out.push(">>>>>>> other device".into());
                }
                pos = end;
                i = li;
                j = ri;
            } else {
                out.extend(base[pos..hunk.start].iter().map(|s| (*s).to_string()));
                out.extend(hunk.lines.iter().cloned());
                pos = hunk.end;
                i += 1;
            }
        } else {
            let hunk = &remote[j];
            if hunk.end <= pos {
                j += 1;
                continue;
            }
            if local.get(i).is_some_and(|h| h.start < hunk.end) {
                let (start, end, li, ri) = cluster(local, remote, i, j);
                out.extend(base[pos..start].iter().map(|s| (*s).to_string()));
                let a = slice_with_hunks(base, start, end, &local[i..li]);
                let b = slice_with_hunks(base, start, end, &remote[j..ri]);
                if a == b {
                    out.extend(a);
                } else {
                    conflict = true;
                    out.push("<<<<<<< this device".into());
                    out.extend(a);
                    out.push("=======".into());
                    out.extend(b);
                    out.push(">>>>>>> other device".into());
                }
                pos = end;
                i = li;
                j = ri;
            } else {
                out.extend(base[pos..hunk.start].iter().map(|s| (*s).to_string()));
                out.extend(hunk.lines.iter().cloned());
                pos = hunk.end;
                j += 1;
            }
        }
    }
    out.extend(base[pos..].iter().map(|s| (*s).to_string()));
    Merge {
        content: out.join("\n"),
        conflict,
    }
}

fn cluster(local: &[Hunk], remote: &[Hunk], i: usize, j: usize) -> (usize, usize, usize, usize) {
    let mut start = usize::MAX;
    let mut end = 0;
    if let Some(h) = local.get(i) {
        start = start.min(h.start);
        end = end.max(h.end);
    }
    if let Some(h) = remote.get(j) {
        start = start.min(h.start);
        end = end.max(h.end);
    }
    let mut li = i;
    let mut ri = j;
    loop {
        let mut grew = false;
        while li < local.len() && local[li].start <= end {
            end = end.max(local[li].end);
            li += 1;
            grew = true;
        }
        while ri < remote.len() && remote[ri].start <= end {
            end = end.max(remote[ri].end);
            ri += 1;
            grew = true;
        }
        if !grew {
            break;
        }
    }
    (start, end, li, ri)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fast_paths() {
        assert_eq!(
            three_way("a", "b", "b"),
            Merge {
                content: "b".into(),
                conflict: false
            }
        );
        assert_eq!(
            three_way("a", "a", "b"),
            Merge {
                content: "b".into(),
                conflict: false
            }
        );
        assert_eq!(
            three_way("a", "b", "a"),
            Merge {
                content: "b".into(),
                conflict: false
            }
        );
    }

    #[test]
    fn non_overlapping_edits() {
        let base = "one\ntwo\nthree\nfour";
        let local = "ONE\ntwo\nthree\nfour";
        let remote = "one\ntwo\nthree\nFOUR";
        let merged = three_way(base, local, remote);
        assert!(!merged.conflict);
        assert_eq!(merged.content, "ONE\ntwo\nthree\nFOUR");
    }

    #[test]
    fn overlapping_keeps_both() {
        let merged = three_way("hello\n", "alpha\n", "beta\n");
        assert!(merged.conflict);
        assert!(merged.content.contains("<<<<<<< this device"));
        assert!(merged.content.contains("alpha"));
        assert!(merged.content.contains("beta"));
        assert!(merged.content.contains(">>>>>>> other device"));
    }
}
