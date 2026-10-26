# Share this source snapshot

The prepared archive is intended for source review by the original dx.bi creator. It contains the current development source, an additions guide, a text patch against the upstream base, licenses, and a file manifest. It is not a signed application release.

## Read the additions guide

Start with [FORK-ADDITIONS.md](FORK-ADDITIONS.md). The [acceptance summary](ACCEPTANCE.md) records current limits. The original upstream README remains in place for attribution and context.

## Privacy boundaries

The export includes no `.git` directory or local commit authorship. It omits local environment files, account databases, signing material, runtime logs, household test captures, raw viewing histories, local build outputs, and release workflows. The export replaces known private profile fixture names, device addresses, and computer paths with neutral examples.

Public upstream names, repository links, copyright notices, and dependency metadata remain. Synthetic security-test credentials remain where they are necessary to test rejection or redaction. They are not configured service credentials.

Automated checks reduce disclosure risk but do not establish anonymous publishing. A GitHub repository, release, issue, pull request, or direct message identifies the account that creates it. A public profile, email, commit author, signing certificate, screenshot, or later attachment can disclose identity independently of the source archive.

Share the prepared ZIP rather than the development checkout, a working-directory backup, a device-data backup, or an existing APK. The latter artifacts have not been approved by this source audit.

## Build locally

Install the dependencies described in `HOUSEHOLD.md` and `tv/README.md`. Configure your own SDK path and credentials. The package excludes `tv/local.properties`, signing keys, and installed dependencies.

Set `ADB_PATH` and `TV_SERIAL` for physical-device verification. Viewer fixtures use neutral names and may need to match disposable profiles on the test installation. Raw test output can contain personal data once real accounts are used.

Release workflows are intentionally absent from the export. Configure an independent publishing destination and signing identity before adding release automation. Preserve the upstream MIT license and other bundled license notices.

## Share status

This snapshot is prepared for publication as a source review repository. Consult the repository hosting page for its owner and publication status. No issue, pull request, or direct message is sent by the export tooling.
