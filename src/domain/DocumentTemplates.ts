export interface DocumentTemplate {
    readonly id: string;
    readonly name: string;
    readonly description: string;
    readonly title: string;
    readonly body: string;
}

export const DOCUMENT_TEMPLATES: readonly DocumentTemplate[] = [
    {
        id: "blank",
        name: "Blank document",
        description: "A clean page for whatever comes next.",
        title: "Untitled document",
        body: ""
    },
    {
        id: "meeting",
        name: "Meeting notes",
        description: "Capture decisions, owners, and next steps.",
        title: "Meeting notes",
        body: String.raw`**Date:** Add meeting date\
**Attendees:** Add names

## Purpose

What do we need to decide or move forward today?

## Discussion

- Add the key points and context.

## Decisions

- Record what was agreed and why.

## Action items

| Action | Owner | Due date |
| --- | --- | --- |
| Add next step | Assign an owner | Set a date |

## Open questions

- What still needs an answer?`
    },
    {
        id: "brief",
        name: "Project brief",
        description: "Align a team on the problem, scope, and success.",
        title: "Project brief",
        body: `## Overview

Describe the project in two or three sentences.

## Problem

Who is affected, and what is difficult for them today?

## Goals

- Define a concrete outcome.
- Describe how you will measure success.

## Scope

### Included

- List the work this project covers.

### Out of scope

- Make the boundaries explicit.

## Milestones

| Milestone | Owner | Target date |
| --- | --- | --- |
| Agree on the approach | Add owner | Add date |
| Deliver the first version | Add owner | Add date |
| Review the results | Add owner | Add date |

## Risks and dependencies

- What could block progress, and how will you address it?

## Next steps

- [ ] Review this brief with the team.
- [ ] Assign owners and confirm dates.`
    },
    {
        id: "report",
        name: "Research report",
        description: "Turn evidence into findings and recommendations.",
        title: "Research report",
        body: `## Summary

State the question, the main finding, and its implication.

## Research question

What are you trying to learn, and why does it matter?

## Method

Describe the sources, participants, or process used to gather evidence.

## Findings

### Finding one

Explain the observation and the evidence behind it.[^1]

### Finding two

Explain how this finding relates to the research question.

## Limitations

What does the evidence leave uncertain?

## Recommendations

1. Describe the recommended action and who should take it.
2. Explain what to investigate next.

## Sources

[^1]: Add the source title, author, date, and URL.`
    },
    {
        id: "guide",
        name: "How-to guide",
        description: "Write instructions people can follow and share.",
        title: "How-to guide",
        body: `## What you will learn

Describe the task and what a successful result looks like.

## Before you start

- List any tools, access, or materials the reader needs.
- Explain any assumptions about their experience.

## Step 1: Get ready

Describe the first action. Include enough detail for someone doing it for the first time.

## Step 2: Complete the task

Break the work into clear, ordered actions.

1. Describe the action.
2. Explain what the reader should see next.
3. Show how to check the result.

## Troubleshooting

| Problem | What to try |
| --- | --- |
| Describe a common issue | Explain how to resolve it |

## Check your result

- [ ] Describe a visible sign that the task is complete.
- [ ] Link to the next useful resource.`
    }
];

export function templateSource(template: DocumentTemplate, title: string): string {
    if (template.id === "blank") return "";
    // A title is always one literal heading, even if pasted from another document.
    const heading = (title.trim() || template.title)
        .replace(/[\r\n]+/g, " ")
        .replace(/[\\`*_{}[\]<>()#!|~$]/g, "\\$&");
    return `# ${heading}\n\n${template.body}\n`;
}
