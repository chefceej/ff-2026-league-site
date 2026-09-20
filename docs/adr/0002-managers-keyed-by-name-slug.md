# Managers are keyed by a name slug, never by ESPN's member id

Every page and file that outlives a season needs one stable identity per
manager, because team names, abbreviations, and logos change yearly. ESPN's own
member id is the obvious key, but it is the member's SWID cookie, half of the
credential pair that unlocks the private league, and this is a public site, so
it must never appear in a URL, a file name, or a data file. Managers are keyed
instead by a slug derived from their ESPN first and last name (`kyle-disch`),
with a small alias map in the fetcher for renames and collisions: a name change
shows up as a new manager on the site and is fixed by adding an alias, never by
reaching for the id. Team abbreviations were rejected as the key because they
change yearly and ESPN lets a manager change them at any time.
