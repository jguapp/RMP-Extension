# Privacy Policy

**RMP for CUNYfirst Schedule Builder**
Last updated: 12 August 2026

## The short version

This extension collects nothing. There is no account, no analytics, no
telemetry, and no server belonging to the developer. Nothing you do is
recorded, transmitted to the developer, or shared with anyone.

## What the extension reads

On CUNYfirst and Schedule Builder pages, it reads the **instructor names
already displayed on the page you are looking at**. That is the only page
content it uses. It does not read your login, your student ID, your schedule,
your grades, your email, or any form you fill in.

## What leaves your browser

Exactly one thing: **an instructor's name**, sent to
`ratemyprofessors.com` to look up that professor's public rating. This is the
same request your browser would make if you searched their name on Rate My
Professors yourself.

Those requests are sent with `credentials: 'omit'`, which means **no cookies
are attached**. Rate My Professors receives a name to search for and cannot
tie it to a Rate My Professors account, logged in or otherwise.

No other host is ever contacted. There is no developer-operated server for
data to be sent to.

## What is stored, and where

Everything is stored locally in your own browser, using the extension storage
API, and never leaves it:

| Stored | Why | Lifetime |
| --- | --- | --- |
| Ratings already looked up | So a results page with 40 instructors does not re-query on every visit | 7 days (1 day for "no profile found") |
| Resolved campus identifiers | So the campus does not need re-resolving | 90 days |
| Your campus choice, if you set one | So the popup remembers it | Until you change it |

Uninstalling the extension deletes all of it.

## Permissions, and why each exists

| Permission | Why it is needed |
| --- | --- |
| `storage` | The local cache above. |
| `scripting` | Registers the extension on a Schedule Builder site you explicitly turn on. |
| `activeTab` | Reads the current tab's address when you open the popup, so it can offer to enable that site. |
| Access to `ratemyprofessors.com` | To fetch the ratings. |
| Access to `*.cuny.edu` and `*.collegescheduler.com` | To find instructor names on the pages that show them. |
| Optional access to other sites | **Not granted at install.** Some campuses serve Schedule Builder from their own address. If yours does, the "Turn on for this site" button asks your browser for permission to that one site, and only that one. You can revoke it at any time. |

The extension does not run on `ratemyprofessors.com` itself.

## Children

The extension is intended for university students and does not knowingly
collect information from anyone, of any age. There is nothing to collect.

## Third parties

Rate My Professors is an independent service with its own privacy practices,
which govern the requests described above. This extension is not affiliated
with, endorsed by, or connected to Rate My Professors or the City University
of New York.

## Changes

Any change to this policy will be committed to this repository, so the full
history of what it has said is public and auditable.

## Contact

Open an issue at https://github.com/jguapp/RMP-Extension/issues
