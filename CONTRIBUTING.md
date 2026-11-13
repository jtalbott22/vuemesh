# Contributing to VUEMesh

VUEMesh is free and open source under the [MIT License](LICENSE). It started as one person's tool for
running live events, and it's meant to grow into something artists, producers, teachers and
developers shape together. If you make shows, video, sound, theatre, music, classes or anything else
with cameras, you're who this is for, and you don't need to write code to help.

## Ways to help

| You are… | You could… |
| --- | --- |
| **Running a show with it** | Tell us how it went. In the studio, **Monitor → Save show log** (or **Help → Copy diagnostics**) gives a report with no recordings in it. Open an issue with it and what you saw: most fixes in the [changelog](CHANGELOG.md) started this way. |
| **An artist or producer** | Describe the show you want to make that VUEMesh can't do yet: a look, a transition, a way to direct, a kind of event. An issue with a sketch or a reference video is perfect. |
| **Testing gear** | Try a webcam, interface, phone, TV, router or stick PC and say what worked. Real-hardware results are some of the most useful things we can get (see *Known limits* in the [README](README.md#known-limits)). |
| **A writer or teacher** | Improve the guides, the [README](README.md), [How it fits together](docs/HOW-IT-WORKS.md), or the words in the app itself. |
| **A developer** | Fix a bug, build a feature, add a test. See below. |

## Running it

Node.js 20 or later. No build step: the app in `public/` is plain HTML, CSS and ES modules, so a
change is an edit and a reload.

```bash
npm install
npm run dev          # http://localhost:8790, and HTTPS on 9790 for phones on your network
npm test             # unit tests
npm run lint         # ESLint (and `ruff check .` for the Python)
npm run test:e2e     # browser suites (Python 3 + Playwright; see docs/TESTS.md)
```

The dev server runs the same API and signalling code as the cloud, in memory, so you don't need an
AWS account to work on anything. [docs/HOW-IT-WORKS.md](docs/HOW-IT-WORKS.md) explains the pieces,
and [Repository layout](README.md#repository-layout) says where they live.

## Sending a change

1. **For anything bigger than a small fix, open an issue first** and say what you have in mind, so we
   can agree on the shape before you spend the time.
2. Fork, branch, and make the change. Keep it to one thing.
3. **Add or update a test** where it fits: `test/*.test.mjs` for logic, `test/e2e_*.py` for what
   happens in the browser. [docs/TESTS.md](docs/TESTS.md) lists them.
4. Run `npm test` and `npm run lint`.
5. **Say what changed for the person using it** in [CHANGELOG.md](CHANGELOG.md), under the newest
   version, in the same plain words as the entries around it.
6. Open a pull request: what it does, why, and how you checked it (a screenshot or short recording
   helps for anything visible).

By sending a contribution you agree it's shared under the project's MIT License. Credit stays with
you: your commits carry your name, and changelog entries can name who made them.

## Versions

Every time the site is deployed, it gets a new version, and the version says what kind of change it is:

- **0.68.1 (patch):** fixes only. Something that should have worked now does.
- **0.69.0 (minor):** anything new that people will see, anything removed, or a change to the Terms
  or the Privacy page.
- **1.0.0:** when we agree it's stable enough to promise people it won't break between versions.

The version lives in three places that must match (a test checks): `package.json`, `APP_VERSION` in
`public/js/brand.js`, and the newest heading in `CHANGELOG.md`. While you work, add to the newest
heading. When it's deployed, it's tagged `vX.Y.Z` on `main` with a GitHub release, and the next
change starts a new heading.

## What we hold to

These are what make VUEMesh what it is. Changes that go against them are unlikely to be merged,
however good they are otherwise. Ask if you're unsure.

- **Privacy first.** No accounts, no cookies, no trackers, no third-party analytics, never anyone's
  location. If a change stores anything new, in the browser or on the server, the
  [Privacy page](public/privacy.html) and the storage note ([notice.js](public/js/notice.js)) say so
  in the same change.
- **No barriers.** Nothing to install, nothing to sign up for. A guest scans a code and is shooting.
- **The local network first.** Video goes device to device. The cloud only introduces them.
- **Plain words.** The app talks like a person running a show, not like software. "The phone's
  picture", not "the remote MediaStreamTrack".
- **Nothing lost.** Recordings are never deleted on someone's behalf, and anything that can be
  undone, is.
- **No build step**, and few dependencies. Anyone should be able to open a file and understand it.

## Good places to start

- **Try it on real hardware** listed under *Known limits* and report what happens.
- **Translations:** the app is English only today. Laying the groundwork for other languages would
  open it to many more people.
- Issues labelled **good first issue** on GitHub.

## Running your own copy

You're free to run VUEMesh yourself, for your venue, your school, your collective, under the MIT
License. [aws/README.md](aws/README.md) deploys it to your own AWS account; it scales to zero and
costs very little when nobody's using it. Please give a changed copy a name of its own so people can
tell it apart from vuemesh.com, and keep the license notice. We'd love to hear what you build.

## Be good to each other

See the [Code of Conduct](CODE_OF_CONDUCT.md). In short: be kind, assume good intent, and remember
that the people here are making things in their spare time.
