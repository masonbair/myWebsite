---
title: On Android, expo-media-library reports creationTime 0 for images with no EXIF date, so never treat 0 as "skip".
applies_when: writing code that filters, sorts or timestamps phone photos read with expo-media-library on Android
date: 2026-11-09
---

**Symptom:** a photo sits in the watched album, the photo job runs with no error and health is green, but nothing uploads.
**Cause:** MediaStore `datetaken` is NULL for files without EXIF DateTimeOriginal (saved or downloaded images, files copied over USB, some screenshots). expo-media-library then reports `creationTime: 0`. The job skipped any asset with `creationTime <= 0` and counted it as "skipped", not as an error.
**Do instead:** use `creationTime > 0 ? creationTime : modificationTime`, and skip only when neither is a positive number. Remember that `getAssetsAsync` can only sort by `creationTime`, so these files sort last.
**Evidence:** found on the Galaxy Tab A9+ on 2026-11-09 (`content query` showed `datetaken=NULL`). Fixed in commit 36f9a5d (`apps/collector/src/photos/photoJob.ts` `takenAt`); covered by `photoJob.test.ts` ("uses the modified time when the creation time is 0").
