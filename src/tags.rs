use serde::Serialize;
use std::collections::{HashMap, HashSet};

const STOP: &[&str] = &[
    "a", "an", "and", "are", "as", "at", "be", "but", "by", "for", "from", "if", "in", "is", "it",
    "not", "of", "on", "or", "that", "the", "this", "to", "was", "with",
];

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HashtagSpan {
    pub tag: String,
    pub start: usize,
    pub end: usize,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct TagSuggest {
    pub name: String,
    pub count: usize,
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub create: bool,
}

#[derive(Debug, Clone)]
pub struct TagDoc<'a> {
    pub tags: &'a [String],
    pub title: &'a str,
    pub folder: &'a str,
    pub content: &'a str,
    pub modified_at: &'a str,
}

pub fn normalize_tag(raw: &str) -> Option<String> {
    let s = raw.trim().trim_start_matches('#').to_ascii_lowercase();
    if s.is_empty() || s.len() > 32 {
        return None;
    }
    let mut chars = s.chars();
    let first = chars.next()?;
    if !first.is_ascii_alphabetic() {
        return None;
    }
    if !s.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') {
        return None;
    }
    if s.contains("--") || s.ends_with('-') {
        return None;
    }
    Some(s)
}

pub fn parse_tags_field(raw: &str) -> Vec<String> {
    let trimmed = raw.trim().trim_matches(['[', ']']);
    union_tags(&[], &parse_tag_list(trimmed.split(',').map(|s| s.trim())))
}

fn parse_tag_list<'a, I: IntoIterator<Item = &'a str>>(items: I) -> Vec<String> {
    items.into_iter().filter_map(normalize_tag).collect()
}

pub fn normalize_tag_list(items: &[String]) -> Result<Vec<String>, String> {
    let mut out = Vec::new();
    for raw in items {
        let Some(tag) = normalize_tag(raw) else {
            return Err(format!("invalid tag: {raw}"));
        };
        if !out.iter().any(|existing| existing == &tag) {
            out.push(tag);
        }
    }
    Ok(out)
}

pub fn format_tags(tags: &[String]) -> String {
    tags.join(", ")
}

pub fn union_tags(existing: &[String], extra: &[String]) -> Vec<String> {
    let mut out = existing.to_vec();
    for tag in extra {
        if !out.iter().any(|e| e == tag) {
            out.push(tag.clone());
        }
    }
    out
}

pub fn parse_tag_query(q: &str) -> Option<String> {
    let q = q.trim();
    let rest = q.strip_prefix('#')?;
    if rest.is_empty() || rest.contains(char::is_whitespace) {
        return None;
    }
    normalize_tag(rest)
}

pub fn extract_hashtags(content: &str) -> Vec<String> {
    union_tags(
        &[],
        &extract_hashtag_spans(content)
            .into_iter()
            .map(|span| span.tag)
            .collect::<Vec<_>>(),
    )
}

pub fn extract_hashtag_spans(content: &str) -> Vec<HashtagSpan> {
    let mut out = Vec::new();
    let mut in_fence = false;
    let mut offset = 0;
    for line in content.split_inclusive('\n') {
        let line_start = offset;
        offset += line.len();
        let body = line.strip_suffix('\n').unwrap_or(line);
        let trimmed = body.trim_start();
        if trimmed.starts_with("```") {
            in_fence = !in_fence;
            continue;
        }
        if in_fence {
            continue;
        }
        let (scan, skip) = if let Some(rest) = skip_atx_heading(body) {
            (rest, body.len() - rest.len())
        } else {
            (body, 0)
        };
        scan_line_hashtags(scan, line_start + skip, &mut out);
    }
    out
}

fn skip_atx_heading(line: &str) -> Option<&str> {
    let indent = line.len() - line.trim_start().len();
    let t = &line[indent..];
    let n = t.chars().take_while(|c| *c == '#').count();
    if n == 0 || n > 6 {
        return None;
    }
    let after = &t[n..];
    if after.starts_with(' ') || after.starts_with('\t') {
        Some(after)
    } else {
        None
    }
}

fn scan_line_hashtags(line: &str, base: usize, out: &mut Vec<HashtagSpan>) {
    let bytes = line.as_bytes();
    let mut in_code = false;
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'`' {
            in_code = !in_code;
            i += 1;
            continue;
        }
        if in_code {
            i += 1;
            continue;
        }
        if bytes[i] == b'#' {
            let boundary = i == 0 || is_tag_boundary(bytes[i - 1] as char);
            if boundary {
                if let Some(tag) = parse_tag_at(&line[i + 1..]) {
                    let start = base + i;
                    let end = start + 1 + tag.len();
                    out.push(HashtagSpan { tag, start, end });
                    i = end - base;
                    continue;
                }
            }
        }
        i += 1;
    }
}

fn is_tag_boundary(c: char) -> bool {
    c.is_whitespace() || matches!(c, '(' | '[' | '{' | '"' | '\'')
}

fn parse_tag_at(rest: &str) -> Option<String> {
    let mut len = 0;
    for (i, c) in rest.char_indices() {
        if i == 0 {
            if !c.is_ascii_alphabetic() {
                return None;
            }
            len = 1;
            continue;
        }
        if c.is_ascii_alphanumeric() || c == '-' {
            len = i + c.len_utf8();
            continue;
        }
        break;
    }
    if len == 0 {
        return None;
    }
    normalize_tag(&rest[..len])
}

pub fn first_hashtag_index(content: &str, tag: &str) -> Option<usize> {
    extract_hashtag_spans(content)
        .into_iter()
        .find(|span| span.tag == tag)
        .map(|span| span.start)
}

pub fn paragraph_at(content: &str, cursor: usize) -> &str {
    if content.is_empty() {
        return "";
    }
    let cursor = cursor.min(content.len());
    let start = content[..cursor].rfind("\n\n").map(|i| i + 2).unwrap_or(0);
    let end = content[cursor..]
        .find("\n\n")
        .map(|i| cursor + i)
        .unwrap_or(content.len());
    &content[start..end]
}

pub fn suggest(
    corpus: &[TagDoc<'_>],
    q: &str,
    current_tags: &[String],
    title: &str,
    folder: &str,
    paragraph: &str,
) -> Vec<TagSuggest> {
    let qn = q.trim().trim_start_matches('#').to_ascii_lowercase();
    let create = normalize_tag(&qn).filter(|tag| {
        !current_tags.iter().any(|t| t == tag)
            && !corpus.iter().any(|doc| doc.tags.iter().any(|t| t == tag))
    });

    let mut counts: HashMap<String, usize> = HashMap::new();
    let mut profiles: HashMap<String, HashMap<String, f64>> = HashMap::new();
    let mut cooccur: HashMap<String, HashSet<String>> = HashMap::new();
    let mut folder_hits: HashMap<String, usize> = HashMap::new();
    let mut latest: HashMap<String, String> = HashMap::new();

    for doc in corpus {
        for tag in doc.tags {
            *counts.entry(tag.clone()).or_insert(0) += 1;
            let profile = profiles.entry(tag.clone()).or_default();
            add_tokens(profile, doc.title, 3.0);
            add_tokens(profile, doc.folder, 2.0);
            add_tokens(profile, doc.content, 1.0);
            add_tokens(profile, tag, 4.0);
            let others = cooccur.entry(tag.clone()).or_default();
            for other in doc.tags {
                if other != tag {
                    others.insert(other.clone());
                }
            }
            if !folder.is_empty() && doc.folder == folder {
                *folder_hits.entry(tag.clone()).or_insert(0) += 1;
            }
            let seen = latest.entry(tag.clone()).or_default();
            if doc.modified_at > seen.as_str() {
                *seen = doc.modified_at.to_string();
            }
        }
    }

    let mut df: HashMap<String, usize> = HashMap::new();
    for profile in profiles.values() {
        for token in profile.keys() {
            *df.entry(token.clone()).or_insert(0) += 1;
        }
    }
    let n_tags = profiles.len().max(1) as f64;

    let mut query: HashMap<String, f64> = HashMap::new();
    add_tokens(&mut query, title, 3.0);
    add_tokens(&mut query, folder, 2.0);
    add_tokens(&mut query, paragraph, 1.0);
    add_tokens(&mut query, &qn, 4.0);
    for tag in current_tags {
        add_tokens(&mut query, tag, 2.0);
    }

    let mut scored: Vec<(f64, String)> = Vec::new();
    for (tag, count) in &counts {
        if current_tags.iter().any(|t| t == tag) {
            continue;
        }
        if !qn.is_empty() && !tag.contains(&qn) {
            continue;
        }
        let profile = profiles.get(tag).cloned().unwrap_or_default();
        let mut overlap = 0.0;
        for (token, qw) in &query {
            if let Some(pw) = profile.get(token) {
                let idf = ((n_tags + 1.0) / (*df.get(token).unwrap_or(&1) as f64 + 1.0)).ln() + 1.0;
                overlap += qw.min(*pw) * idf;
            }
        }
        let prefix = if tag == &qn {
            10.0
        } else if tag.starts_with(&qn) && !qn.is_empty() {
            5.0
        } else if !qn.is_empty() {
            2.0
        } else {
            0.0
        };
        let others = cooccur.get(tag).cloned().unwrap_or_default();
        let inter = current_tags.iter().filter(|t| others.contains(*t)).count() as f64;
        let union = (current_tags.len() + others.len()) as f64;
        let jaccard = if union == 0.0 { 0.0 } else { inter / union };
        let folder_aff = *folder_hits.get(tag).unwrap_or(&0) as f64 / (*count as f64).max(1.0);
        let score = overlap * 3.0 + prefix + jaccard * 1.5 + folder_aff * 0.5;
        scored.push((score, tag.clone()));
    }
    scored.sort_by(|a, b| {
        b.0.partial_cmp(&a.0)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| a.1.cmp(&b.1))
    });
    let cap = if create.is_some() { 7 } else { 8 };
    let mut out: Vec<TagSuggest> = scored
        .into_iter()
        .take(cap)
        .map(|(_, name)| TagSuggest {
            count: *counts.get(&name).unwrap_or(&0),
            name,
            create: false,
        })
        .collect();
    if let Some(name) = create {
        out.push(TagSuggest {
            name,
            count: 0,
            create: true,
        });
    }
    out
}

fn add_tokens(map: &mut HashMap<String, f64>, text: &str, weight: f64) {
    for token in tokenize(text) {
        *map.entry(token).or_insert(0.0) += weight;
    }
}

fn tokenize(text: &str) -> Vec<String> {
    text.to_ascii_lowercase()
        .split(|c: char| !c.is_ascii_alphanumeric())
        .filter(|w| w.len() >= 2 && !STOP.contains(w))
        .map(|w| w.to_string())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalize_and_parse() {
        assert_eq!(normalize_tag("#Work").as_deref(), Some("work"));
        assert_eq!(normalize_tag("meeting").as_deref(), Some("meeting"));
        assert!(normalize_tag("123").is_none());
        assert!(normalize_tag("work/meeting").is_none());
        assert!(normalize_tag("work-").is_none());
        assert_eq!(parse_tags_field("work, Meeting, work"), vec!["work", "meeting"]);
        assert_eq!(parse_tag_query("#work").as_deref(), Some("work"));
        assert!(parse_tag_query("work").is_none());
        assert!(parse_tag_query("#").is_none());
    }

    #[test]
    fn extract_skips_headings_and_code() {
        let content = "# Title\n\nsee #work and #Meeting\n\n```\n#code\n```\n\n`#skip` and (#rust)\n";
        assert_eq!(extract_hashtags(content), vec!["work", "meeting", "rust"]);
        assert!(first_hashtag_index(content, "work").is_some());
        assert!(extract_hashtags("# 2026-08-31\n\n").is_empty());
    }

    #[test]
    fn suggest_ranks_overlap_and_prefix() {
        let rust_tags = vec!["rust".to_string()];
        let meet_tags = vec!["meeting".to_string()];
        let both = vec!["rust".to_string(), "meeting".to_string()];
        let corpus = [
            TagDoc {
                tags: &rust_tags,
                title: "Borrow checker",
                folder: "dev",
                content: "ownership rust lifetimes",
                modified_at: "2",
            },
            TagDoc {
                tags: &meet_tags,
                title: "Standup",
                folder: "work",
                content: "weekly meeting notes",
                modified_at: "1",
            },
            TagDoc {
                tags: &both,
                title: "RFC review",
                folder: "dev",
                content: "rust rfc meeting",
                modified_at: "3",
            },
        ];
        let hits = suggest(&corpus, "ru", &[], "lifetime notes", "dev", "ownership");
        assert_eq!(hits[0].name, "rust");
        assert!(!hits[0].create);
        let created = suggest(&corpus, "newtag", &[], "", "", "");
        assert!(created.last().is_some_and(|h| h.create && h.name == "newtag"));
        let excluded = suggest(&corpus, "", &rust_tags, "ownership", "dev", "lifetimes");
        assert!(excluded.iter().all(|h| h.name != "rust"));
    }
}
