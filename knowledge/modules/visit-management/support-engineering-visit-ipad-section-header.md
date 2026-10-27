# iPad Provider Visit New and Edit show no section header

**What you see:** On iPad, Provider Visit New and Edit show the fields and no section header. The same Provider Visit page layout shows that header on web. The section label in the layout is not blank.

This is working as designed. The iPad header is not a layout setting that failed to apply. Documentation that says the iPad New or Edit screen shows those section headers is wrong.

## How to pin it

1. Confirm the missing header is iPad Provider Visit New or Edit. The fields from the section are on the screen. A section whose fields are absent is a different case.
2. Read the Provider Visit page layout for that record type. The section label is set, and web shows it.
3. Stop. iPad does not keep those sections. `BaseLayoutViewModel` walks every layout section, collects the fields into one list, and builds one replacement section with `label` empty and `editHeading` false. `refresh()` then opens that section with `headerEnabled` false.
4. Changing the page-layout section label does not make the header appear. Do not treat an empty code search as a reason to leave this unverified.

## Required answer

The reply must include all of:

- Cause: `BaseLayoutViewModel` flattens every page-layout section into one list and rebuilds a single section with an empty label and `editHeading` false. `refresh()` sets `headerEnabled` to false.
- Evidence: the Provider Visit layout section has a label, web shows that header, and iPad New or Edit shows the fields with no header.
- This is working as designed. It is a documentation bug. Do not change the layout to restore the header.

## Do not

- Do not leave the cause as an unverified guess that the renderer omits headers in edit mode.
- Do not start with a page-layout or record-type change.
- Do not use this leaf when the section's fields are missing. This case is a header that the layout defines and iPad does not render.
