# Source intake policy (checked 2026-09-28)

This Goal 5 pipeline reads **local, user-supplied files only**. A source URL is
provenance metadata, never a fetch instruction. It does not log in, bypass a
CAPTCHA, crawl a site, download a floor map, or republish an image/PDF. Access
and reuse permission must be reviewed for each new source before adding a
future network connector. `robots.txt` alone is not permission to reuse data.

| Source | robots.txt / ordinary access | Terms and reuse | Goal 5 decision |
| --- | --- | --- | --- |
| P-WORLD (`www.p-world.co.jp`) | [robots.txt](https://www.p-world.co.jp/robots.txt) allows general paths but disallows `/_info/hall/`; home page is public. Some store features may require an account or have access controls; no bypass was attempted. | [Terms §8](https://www.p-world.co.jp/_info/user/rules1.htm) restrict unauthorized data collection and secondary use/republication. | No automated retrieval. Accept a locally provided map or independently prepared structured facts only after the user's rights review; never publish source artwork. |
| みんレポ (`min-repo.com`) | [robots.txt](https://min-repo.com/robots.txt) was reachable and has an Amazonbot prohibition, a meta-externalagent crawl delay, and no general disallow. Public home/report pages load normally. This does not establish permission for bulk extraction. | [About](https://min-repo.com/about/) requires a link to the relevant page when quoting data. No blanket bulk-collection or image-republication permission was located. | No automated retrieval. User-provided, legally extracted structured facts only, with a page URL in provenance; do not copy report pages or images into published JSON. |
| PAPIMO (`papimo.jp`), referenced by an existing hall | [robots.txt](https://papimo.jp/robots.txt) disallows several paths and allows some public paths. The home page is public; individual pages may differ. | [Terms §12](https://papimo.jp/support/rule) prohibit unapproved automated collection, HTML extraction, secondary use, and third-party store-data creation/disclosure. | No automated retrieval or publication from PAPIMO without explicit permission. |
| Individual store official sites and their map images/PDFs | Host-specific robots/terms, account needs, and access controls vary. No blanket result is possible. | Copyright/republication permission must be checked per site and artifact. | Local manual input only. A source URL is recorded for review; raw images/PDFs remain in internal working files, not public layout JSON. |
| FLOOR777's own existing files | Local files under this repository, no external access. | Existing public hall data and Golden Fixtures remain unchanged. | Read-only comparison fixtures are allowed. |

If the supplied material requires login, CAPTCHA solving, access-control
evasion, or scraping contrary to terms, do not acquire it with this tool.
The operator must supply a permitted local artifact or omit the source. A
`sourceUrl` never causes a network request. Third-party permissions and
publication rights remain a separate Goal 6 review.
