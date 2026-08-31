/** The extension's own page, rendered by both the sidebar and a full tab. */
const APP_PAGE = '/sidepanel.html';

export default defineBackground(() => {
  /**
   * Toolbar click opens the app in a normal browser tab.
   *
   * The sidebar is still there (`sidebar_action`), but it is only ever ~350px
   * wide, which is the app's narrow layout. Opening the same page as a tab
   * gives the desktop layout with no separate build or code path — the shell
   * branches on viewport width alone.
   *
   * This deliberately does not look for an already-open tab: filtering
   * `tabs.query()` by url needs the `tabs` permission, which is a meaningful
   * step up in AMO review scrutiny (it grants the URL of every open tab) for
   * nothing more than avoiding a duplicate tab.
   */
  browser.action.onClicked.addListener(() => {
    void browser.tabs.create({ url: browser.runtime.getURL(APP_PAGE) });
  });
});
