<template lang="pug">
.page
  .page-header
    h1.page-title Privacy
    p.page-sub What data this site collects and why

  .privacy-body
    p.lead
      | This site does collect some aggregate information about visitors — browser types, general geographic regions,
      | and monitor resolutions — purely for development and debugging purposes.

    .section
      h2.section-title What we don't do
      ul.check-list
        li This site does not use tracking cookies
        li This site does not collect personally identifiable information
        li This site does not share or sell information to any third parties or social media sites
        li This site does not participate in any cross-site tracking

    .section
      h2.section-title Analytics
      p
        | We use&nbsp;
        a(href="https://swetrix.com" target="_blank") swetrix.com
        | , an open source, privacy-focused analytics tool. It is a paid service with no incentive for misuse of data.

    .section
      h2.section-title Your data
      p This site is served over a TLS encrypted connection (see the lock icon in your browser) so your Quake session data will not be leaked.
      p All data added via the setup utility remains in your browser and is never sent to our servers.
      p
        | For more information about how data is collected and stored, visit&nbsp;
        a(href="https://swetrix.com/privacy" target="_blank") swetrix.com/privacy
</template>

<style lang="scss" scoped>
@import '../../../scss/tokens';

.page {
  max-width: 1000px;
  margin: 0 auto;
  padding: 48px;
  @media (max-width: 768px) { padding: 32px 24px; }
  @media (max-width: 480px) { padding: 24px 16px; }
}

.page-header { margin-bottom: 40px; }

.page-title {
  font-size: 28px;
  font-weight: $fw-black;
  color: $palette-bright;
  letter-spacing: -0.02em;
}

.page-sub {
  font-size: $font-sm;
  color: $palette-muted;
  margin-top: $gap-1;
}

.privacy-body {
  max-width: 640px;
  display: flex;
  flex-direction: column;
  gap: 32px;
}

.lead {
  font-size: $font-base;
  color: $palette-text;
  line-height: 1.7;
}

.section { display: flex; flex-direction: column; gap: 12px; }

.section-title {
  font-size: $font-sm;
  font-weight: $fw-bold;
  text-transform: uppercase;
  letter-spacing: $tracking-labels;
  color: $palette-muted;
  padding-bottom: 8px;
  border-bottom: $border-subtle;
}

p {
  font-size: $font-sm;
  color: $palette-text;
  line-height: 1.7;
  margin: 0;
}

a {
  color: $palette-yellow;
  text-decoration: none;
  &:hover { text-decoration: underline; }
}

.check-list {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;

  li {
    font-size: $font-sm;
    color: $palette-text;
    line-height: 1.5;
    padding-left: 20px;
    position: relative;

    &::before {
      content: '—';
      position: absolute;
      left: 0;
      color: $palette-muted;
    }
  }
}
</style>
