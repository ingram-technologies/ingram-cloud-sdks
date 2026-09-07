# `@ingram-cloud/cli`

`ic` — the Ingram Cloud command line. Every `/v1` operation as a command,
browser sign-in, and a terminal chat with a smith. The long-form docs (naming,
`--json`, shell completion, walkthroughs) are at
[cloud.ingram.tech/docs/cli](https://cloud.ingram.tech/docs/cli); this is the
short version.

## Install

```sh
npm install -g @ingram-cloud/cli
```

## Sign in

```sh
ic login              # opens a browser, no key to paste
ic project use acme   # everything after this runs against "acme"
```

`ic login` mints an **organization key** and stores it under your OS config
directory. `ic project use` picks one project (a tenant) and mints a
project-scoped token for it — that token, not the organization key, is what
every `/v1` command after this sends.

## The shape of the tree

The tree mirrors the `/v1` surface: `ic <resource> <action> [args] [flags]`,
one command per operation, generated from the API's own OpenAPI document.

```sh
ic smiths create --external-id user_42 --display-name "Ada Lovelace"
ic smiths list --json | jq '.data[].id'
ic smiths get user_42
```

A positional can be the id, the resource's natural key (here, `external_id`),
a git-style id prefix, or `last`/`last~N` for the most recently seen one — see
the docs page for the full rule. `ic <resource> <action> --help` at any level
shows what a command takes; `ic api <method> <path>` reaches an endpoint with
no command of its own.

## Chat

```sh
ic chat --smith user_42
```

Starts an interactive REPL against that smith: streamed replies, an
approve/reject prompt when a run pauses for approval, Ctrl-C to cancel a live
turn. Pass the message as an argument instead of `--smith`'s prompt for a
one-shot, scriptable turn:

```sh
ic chat --smith user_42 "What's on my account?"
```

## Naming

- `ic <resource> get <ref>` — `<ref>` is an id (`smt_…`), a natural key
  (a smith's `external_id`, an agent's `slug`), a unique id prefix, or `last`.
- `--json` on any command prints the response body unchanged, and every
  command does this automatically once stdout isn't a terminal — so
  `ic smiths list | jq` needs no flag.
- `ic shell completion` installs bash tab-completion, including resource ids
  from ones you've recently used.

MIT.
