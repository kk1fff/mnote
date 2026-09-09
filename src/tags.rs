use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::ops::Range;

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

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TagQuery {
    pub here: bool,
    pub chain: Vec<String>,
    pub needle: String,
}

impl TagQuery {
    pub fn last_tag(&self) -> Option<String> {
        if self.needle.is_empty() {
            return None;
        }
        normalize_tag(&self.needle)
    }
}

pub fn parse_tag_query(q: &str) -> Option<String> {
    let tq = parse_structured_tag_query(q)?;
    if tq.here || !tq.chain.is_empty() {
        return None;
    }
    tq.last_tag()
}

pub fn parse_structured_tag_query(q: &str) -> Option<TagQuery> {
    let q = q.trim();
    let (here, rest) = if let Some(rest) = q.strip_prefix('>') {
        (true, rest.trim_start())
    } else {
        (false, q)
    };
    if rest.is_empty() {
        return if here {
            Some(TagQuery {
                here,
                chain: Vec::new(),
                needle: String::new(),
            })
        } else {
            None
        };
    }
    if !rest.starts_with('#') {
        return None;
    }
    let parts: Vec<&str> = rest.split('>').map(str::trim).collect();
    let mut chain = Vec::new();
    for (i, part) in parts.iter().enumerate() {
        let last = i + 1 == parts.len();
        if part.is_empty() {
            if last {
                return Some(TagQuery {
                    here,
                    chain,
                    needle: String::new(),
                });
            }
            return None;
        }
        let name = part.strip_prefix('#')?;
        if name.contains(char::is_whitespace) {
            return None;
        }
        if last {
            return Some(TagQuery {
                here,
                chain,
                needle: name.to_ascii_lowercase(),
            });
        }
        chain.push(normalize_tag(name)?);
    }
    None
}

#[derive(Debug, Clone, Copy)]
enum LineKind {
    Fence,
    Heading { level: u8 },
    List { indent: usize },
    Blank,
    Text,
}

struct LineInfo {
    start: usize,
    end: usize,
    indent: usize,
    kind: LineKind,
}

fn visual_indent(line: &str) -> usize {
    let mut n = 0;
    for c in line.chars() {
        match c {
            ' ' => n += 1,
            '\t' => n += 4,
            _ => break,
        }
    }
    n
}

fn atx_heading_level(line: &str) -> Option<u8> {
    skip_atx_heading(line)?;
    let t = line.trim_start();
    Some(t.chars().take_while(|c| *c == '#').count() as u8)
}

fn list_item_indent(line: &str) -> Option<usize> {
    let indent = visual_indent(line);
    let rest = line.trim_start();
    let marked = if rest.starts_with("- ")
        || rest.starts_with("-\t")
        || rest.starts_with("* ")
        || rest.starts_with("*\t")
        || rest.starts_with("+ ")
        || rest.starts_with("+\t")
    {
        true
    } else {
        let digits = rest.chars().take_while(|c| c.is_ascii_digit()).count();
        if digits == 0 {
            false
        } else {
            let after = &rest[digits..];
            after.starts_with(". ") || after.starts_with(".\t")
        }
    };
    marked.then_some(indent)
}

fn line_infos(content: &str) -> Vec<LineInfo> {
    let mut lines = Vec::new();
    let mut in_fence = false;
    let mut offset = 0;
    for line in content.split_inclusive('\n') {
        let start = offset;
        offset += line.len();
        let body = line.strip_suffix('\n').unwrap_or(line);
        let trimmed = body.trim_start();
        if trimmed.starts_with("```") {
            in_fence = !in_fence;
            lines.push(LineInfo {
                start,
                end: offset,
                indent: visual_indent(body),
                kind: LineKind::Fence,
            });
            continue;
        }
        let kind = if in_fence {
            LineKind::Fence
        } else if trimmed.is_empty() {
            LineKind::Blank
        } else if let Some(level) = atx_heading_level(body) {
            LineKind::Heading { level }
        } else if let Some(indent) = list_item_indent(body) {
            LineKind::List { indent }
        } else {
            LineKind::Text
        };
        lines.push(LineInfo {
            start,
            end: offset,
            indent: visual_indent(body),
            kind,
        });
    }
    lines
}

fn container_end(lines: &[LineInfo], i: usize) -> usize {
    match lines[i].kind {
        LineKind::List { indent } => {
            let mut end = lines[i].end;
            for next in &lines[i + 1..] {
                match next.kind {
                    LineKind::Blank => {
                        end = next.end;
                    }
                    LineKind::Heading { .. } => break,
                    LineKind::List { indent: child } if child > indent => {
                        end = next.end;
                    }
                    LineKind::Text | LineKind::Fence if next.indent > indent => {
                        end = next.end;
                    }
                    _ => break,
                }
            }
            end
        }
        LineKind::Heading { level } => {
            let mut end = lines[i].end;
            for next in &lines[i + 1..] {
                if let LineKind::Heading { level: next_level } = next.kind {
                    if next_level <= level {
                        break;
                    }
                }
                end = next.end;
            }
            end
        }
        _ => lines[i].end,
    }
}

fn hashtag_scopes(content: &str) -> Vec<(HashtagSpan, Range<usize>)> {
    let lines = line_infos(content);
    extract_hashtag_spans(content)
        .into_iter()
        .map(|span| {
            let i = lines
                .iter()
                .position(|line| span.start >= line.start && span.start < line.end)
                .unwrap_or(0);
            let end = if lines.is_empty() {
                content.len()
            } else {
                container_end(&lines, i)
            };
            let start = lines.get(i).map(|line| line.start).unwrap_or(0);
            (span, start..end)
        })
        .collect()
}

fn chain_containers(
    scoped: &[(HashtagSpan, Range<usize>)],
    chain: &[String],
) -> Vec<(usize, usize, usize)> {
    let mut ranges = vec![(0, usize::MAX, usize::MAX)];
    for tag in chain {
        let mut next = Vec::new();
        for (rs, re, _) in &ranges {
            for (span, container) in scoped {
                if span.tag != *tag {
                    continue;
                }
                if span.start < *rs || span.start >= *re {
                    continue;
                }
                next.push((container.start, container.end, span.start));
            }
        }
        ranges = next;
        if ranges.is_empty() {
            return Vec::new();
        }
    }
    ranges
}

pub fn search_tag_chain(content: &str, chain: &[String]) -> Vec<HashtagSpan> {
    let Some((last, parents)) = chain.split_last() else {
        return Vec::new();
    };
    let scoped = hashtag_scopes(content);
    let ranges: Vec<(usize, usize)> = if parents.is_empty() {
        vec![(0, usize::MAX)]
    } else {
        chain_containers(&scoped, parents)
            .into_iter()
            .map(|(start, end, _)| (start, end))
            .collect()
    };
    scoped
        .into_iter()
        .filter(|(span, _)| {
            span.tag == *last && ranges.iter().any(|(s, e)| span.start >= *s && span.start < *e)
        })
        .map(|(span, _)| span)
        .collect()
}

pub fn count_scoped_tags(
    content: &str,
    chain: &[String],
    needle: &str,
    counts: &mut HashMap<String, usize>,
) {
    let scoped = hashtag_scopes(content);
    if chain.is_empty() {
        for (span, _) in scoped {
            if !needle.is_empty() && !span.tag.contains(needle) {
                continue;
            }
            *counts.entry(span.tag).or_insert(0) += 1;
        }
        return;
    }
    let containers = chain_containers(&scoped, chain);
    let mut seen = HashSet::new();
    for (start, end, parent_start) in containers {
        for (span, _) in &scoped {
            if span.start < start || span.start >= end {
                continue;
            }
            if span.start == parent_start {
                continue;
            }
            if !needle.is_empty() && !span.tag.contains(needle) {
                continue;
            }
            if !seen.insert(span.start) {
                continue;
            }
            *counts.entry(span.tag.clone()).or_insert(0) += 1;
        }
    }
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

pub fn char_index(content: &str, byte: usize) -> usize {
    content
        .get(..byte.min(content.len()))
        .map(|prefix| prefix.chars().count())
        .unwrap_or(0)
}

pub fn line_at(content: &str, byte: usize) -> usize {
    content
        .get(..byte.min(content.len()))
        .map(|prefix| prefix.bytes().filter(|&b| b == b'\n').count() + 1)
        .unwrap_or(1)
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
        if qn.is_empty() && current_tags.iter().any(|t| t == tag) {
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
        assert!(parse_tag_query("> #work").is_none());
        assert!(parse_tag_query("#work > #meeting").is_none());
        assert_eq!(
            parse_structured_tag_query("#work"),
            Some(TagQuery {
                here: false,
                chain: vec![],
                needle: "work".into(),
            })
        );
        assert_eq!(
            parse_structured_tag_query("> #work"),
            Some(TagQuery {
                here: true,
                chain: vec![],
                needle: "work".into(),
            })
        );
        assert_eq!(
            parse_structured_tag_query(">#work"),
            Some(TagQuery {
                here: true,
                chain: vec![],
                needle: "work".into(),
            })
        );
        assert_eq!(
            parse_structured_tag_query(">"),
            Some(TagQuery {
                here: true,
                chain: vec![],
                needle: String::new(),
            })
        );
        assert_eq!(
            parse_structured_tag_query("#work > #meeting"),
            Some(TagQuery {
                here: false,
                chain: vec!["work".into()],
                needle: "meeting".into(),
            })
        );
        assert_eq!(
            parse_structured_tag_query("#work>#meeting"),
            Some(TagQuery {
                here: false,
                chain: vec!["work".into()],
                needle: "meeting".into(),
            })
        );
        assert_eq!(
            parse_structured_tag_query("#work >"),
            Some(TagQuery {
                here: false,
                chain: vec!["work".into()],
                needle: String::new(),
            })
        );
        assert_eq!(
            parse_structured_tag_query("#a > #b > #c"),
            Some(TagQuery {
                here: false,
                chain: vec!["a".into(), "b".into()],
                needle: "c".into(),
            })
        );
        assert!(parse_structured_tag_query("#work extra").is_none());
        assert!(parse_structured_tag_query("> work").is_none());
        assert!(parse_structured_tag_query("work").is_none());
    }

    #[test]
    fn nested_list_and_heading_scopes() {
        let content = "- #work\n  - standup #meeting\n- sibling #meeting\n\n## Planning #work\nsection #meeting\n\n## Other\noutside #meeting\n\nsame #work #inline\n";
        let nested = search_tag_chain(content, &["work".into(), "meeting".into()]);
        let lines: Vec<usize> = nested.iter().map(|span| line_at(content, span.start)).collect();
        assert_eq!(lines, vec![2, 6]);
        assert!(search_tag_chain(content, &["work".into()]).len() >= 2);

        let mut counts = HashMap::new();
        count_scoped_tags(content, &["work".into()], "", &mut counts);
        assert!(counts.get("meeting").copied().unwrap_or(0) >= 2);
        assert!(!counts.contains_key("work"));

        let same = "- #work #meeting\n";
        let hits = search_tag_chain(same, &["work".into(), "meeting".into()]);
        assert_eq!(hits.len(), 1);

        let three = "- #a\n  - #b\n    - #c\n  - other #c\n";
        assert_eq!(search_tag_chain(three, &["a".into(), "b".into(), "c".into()]).len(), 1);
        assert_eq!(search_tag_chain(three, &["a".into(), "c".into()]).len(), 2);
    }

    #[test]
    fn extract_skips_headings_and_code() {
        let content = "# Title\n\nsee #work and #Meeting\n\n```\n#code\n```\n\n`#skip` and (#rust)\n";
        assert_eq!(extract_hashtags(content), vec!["work", "meeting", "rust"]);
        assert_eq!(char_index(content, 0), 0);
        assert_eq!(line_at("a #work\nb\n", 8), 2);
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
        let reuse = suggest(&corpus, "ru", &rust_tags, "lifetime notes", "dev", "ownership");
        assert!(reuse.iter().any(|h| h.name == "rust" && !h.create));
    }
}
