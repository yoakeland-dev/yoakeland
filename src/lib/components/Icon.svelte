<script lang="ts">
  // Tabler Icons, inlined at build time via Vite's `?raw` loader so they
  // inherit color like text (strokes are `currentColor`).
  import plus from "@tabler/icons/outline/plus.svg?raw";
  import arrowBackUp from "@tabler/icons/outline/arrow-back-up.svg?raw";
  import switchHorizontal from "@tabler/icons/outline/switch-horizontal.svg?raw";
  import layoutGrid from "@tabler/icons/outline/layout-grid.svg?raw";
  import dots from "@tabler/icons/outline/dots.svg?raw";
  import code from "@tabler/icons/outline/code.svg?raw";
  import messageQuestion from "@tabler/icons/outline/message-question.svg?raw";
  import listSearch from "@tabler/icons/outline/list-search.svg?raw";
  import worldWww from "@tabler/icons/outline/world-www.svg?raw";
  import gitCompare from "@tabler/icons/outline/git-compare.svg?raw";
  import circleCheck2 from "@tabler/icons/outline/checks.svg?raw";
  import send from "@tabler/icons/outline/send.svg?raw";
  import pause from "@tabler/icons/outline/player-pause.svg?raw";
  import atSign from "@tabler/icons/outline/at.svg?raw";
  import logIn from "@tabler/icons/outline/login.svg?raw";
  import chevronRight from "@tabler/icons/outline/chevron-right.svg?raw";
  import chevronLeft from "@tabler/icons/outline/chevron-left.svg?raw";
  import warningTriangle from "@tabler/icons/outline/alert-triangle.svg?raw";
  import folder from "@tabler/icons/outline/folder.svg?raw";
  import computer from "@tabler/icons/outline/device-desktop.svg?raw";
  import cloud from "@tabler/icons/outline/cloud.svg?raw";
  import xmark from "@tabler/icons/outline/x.svg?raw";
  import search from "@tabler/icons/outline/search.svg?raw";
  import sidebarLeftCollapse from "@tabler/icons/outline/layout-sidebar-left-collapse.svg?raw";
  import sidebarLeftExpand from "@tabler/icons/outline/layout-sidebar-left-expand.svg?raw";
  import sidebarRightCollapse from "@tabler/icons/outline/layout-sidebar-right-collapse.svg?raw";
  import sidebarRightExpand from "@tabler/icons/outline/layout-sidebar-right-expand.svg?raw";
  import settings from "@tabler/icons/outline/settings.svg?raw";
  import sunLight from "@tabler/icons/outline/sun.svg?raw";
  import halfMoon from "@tabler/icons/outline/moon.svg?raw";
  import minus from "@tabler/icons/outline/minus.svg?raw";
  import square from "@tabler/icons/outline/square.svg?raw";
  import network from "@tabler/icons/outline/network.svg?raw";
  import server from "@tabler/icons/outline/server.svg?raw";
  import laptop from "@tabler/icons/outline/device-laptop.svg?raw";
  import devices from "@tabler/icons/outline/devices.svg?raw";
  import user from "@tabler/icons/outline/user.svg?raw";
  import mediaImage from "@tabler/icons/outline/photo.svg?raw";
  import palette from "@tabler/icons/outline/palette.svg?raw";
  import history from "@tabler/icons/outline/history.svg?raw";
  import cornerUpLeft from "@tabler/icons/outline/corner-up-left.svg?raw";
  import userX from "@tabler/icons/outline/user-x.svg?raw";
  import folderOpen from "@tabler/icons/outline/folder-open.svg?raw";
  import chevronUp from "@tabler/icons/outline/chevron-up.svg?raw";
  import layoutColumns from "@tabler/icons/outline/layout-columns.svg?raw";
  import messageCircle from "@tabler/icons/outline/message-circle.svg?raw";
  import alertCircle from "@tabler/icons/outline/alert-circle.svg?raw";
  import circleCheck from "@tabler/icons/outline/circle-check.svg?raw";
  import loader2 from "@tabler/icons/outline/loader-2.svg?raw";
  import archive from "@tabler/icons/outline/archive.svg?raw";
  import restore from "@tabler/icons/outline/restore.svg?raw";
  import star from "@tabler/icons/outline/star.svg?raw";
  import starFilled from "@tabler/icons/filled/star.svg?raw";
  import paperclip from "@tabler/icons/outline/paperclip.svg?raw";
  import chevronDown from "@tabler/icons/outline/chevron-down.svg?raw";
  import layoutSidebarRight from "@tabler/icons/outline/layout-sidebar-right.svg?raw";
  import terminal2 from "@tabler/icons/outline/terminal-2.svg?raw";
  import messageCirclePlus from "@tabler/icons/outline/message-circle-plus.svg?raw";
  import folderCog from "@tabler/icons/outline/folder-cog.svg?raw";
  import folderPlus from "@tabler/icons/outline/folder-plus.svg?raw";
  import check from "@tabler/icons/outline/check.svg?raw";
  import pencil from "@tabler/icons/outline/pencil.svg?raw";
  import copy from "@tabler/icons/outline/copy.svg?raw";
  import unlink from "@tabler/icons/outline/unlink.svg?raw";
  import trash from "@tabler/icons/outline/trash.svg?raw";
  import maximize from "@tabler/icons/outline/arrows-maximize.svg?raw";
  import contrast2 from "@tabler/icons/outline/contrast-2.svg?raw";
  import questionMark from "@tabler/icons/outline/question-mark.svg?raw";
  import clipboardList from "@tabler/icons/outline/clipboard-list.svg?raw";
  import playerTrackNext from "@tabler/icons/outline/player-track-next.svg?raw";
  import fileText from "@tabler/icons/outline/file-text.svg?raw";
  import filePlus from "@tabler/icons/outline/file-plus.svg?raw";
  import brain from "@tabler/icons/outline/brain.svg?raw";
  import tool from "@tabler/icons/outline/tool.svg?raw";
  import world from "@tabler/icons/outline/world.svg?raw";
  import arrowNarrowUp from "@tabler/icons/outline/arrow-narrow-up.svg?raw";
  import arrowNarrowDown from "@tabler/icons/outline/arrow-narrow-down.svg?raw";
  import refresh from "@tabler/icons/outline/refresh.svg?raw";
  import eye from "@tabler/icons/outline/eye.svg?raw";
  import bell from "@tabler/icons/outline/bell.svg?raw";
  import file from "@tabler/icons/outline/file.svg?raw";
  import cpu from "@tabler/icons/outline/cpu.svg?raw";
  import command from "@tabler/icons/outline/command.svg?raw";
  import keyboard from "@tabler/icons/outline/keyboard.svg?raw";
  import arrowsExchange from "@tabler/icons/outline/arrows-exchange.svg?raw";
  import pin from "@tabler/icons/outline/pin.svg?raw";
  import pinned from "@tabler/icons/outline/pinned.svg?raw";
  import gitBranch from "@tabler/icons/outline/git-branch.svg?raw";
  import clock from "@tabler/icons/outline/clock.svg?raw";
  import filter from "@tabler/icons/outline/filter.svg?raw";
  import bellFilled from "@tabler/icons/filled/bell.svg?raw";
  import chartBar from "@tabler/icons/outline/chart-bar.svg?raw";
  import infoCircle from "@tabler/icons/outline/info-circle.svg?raw";
  import logout from "@tabler/icons/outline/logout.svg?raw";
  import selector from "@tabler/icons/outline/selector.svg?raw";
  import clearAll from "@tabler/icons/outline/clear-all.svg?raw";
  import arrowsMinimize from "@tabler/icons/outline/arrows-minimize.svg?raw";
  import circleX from "@tabler/icons/outline/circle-x.svg?raw";
  import playerStop from "@tabler/icons/outline/player-stop.svg?raw";
  import playerPlay from "@tabler/icons/outline/player-play.svg?raw";
  import folderCode from "@tabler/icons/outline/folder-code.svg?raw";
  import folderCheck from "@tabler/icons/outline/folder-check.svg?raw";
  import folderBolt from "@tabler/icons/outline/folder-bolt.svg?raw";
  import folderShare from "@tabler/icons/outline/folder-share.svg?raw";
  import folderStar from "@tabler/icons/outline/folder-star.svg?raw";
  import folderDown from "@tabler/icons/outline/folder-down.svg?raw";
  import brandNpm from "@tabler/icons/outline/brand-npm.svg?raw";
  import brandGithub from "@tabler/icons/outline/brand-github.svg?raw";
  import brandVscode from "@tabler/icons/outline/brand-vscode.svg?raw";
  import brandDocker from "@tabler/icons/outline/brand-docker.svg?raw";
  import browser from "@tabler/icons/outline/browser.svg?raw";
  import arrowsDiff from "@tabler/icons/outline/arrows-diff.svg?raw";
  import robot from "@tabler/icons/outline/robot.svg?raw";
  import files from "@tabler/icons/outline/files.svg?raw";
  import arrowLeft from "@tabler/icons/outline/arrow-left.svg?raw";
  import arrowRight from "@tabler/icons/outline/arrow-right.svg?raw";
  import aspectRatio from "@tabler/icons/outline/aspect-ratio.svg?raw";
  import deviceMobile from "@tabler/icons/outline/device-mobile.svg?raw";
  import deviceTablet from "@tabler/icons/outline/device-tablet.svg?raw";
  import externalLink from "@tabler/icons/outline/external-link.svg?raw";
  import deviceFloppy from "@tabler/icons/outline/device-floppy.svg?raw";
  import gitCommit from "@tabler/icons/outline/git-commit.svg?raw";
  import fileDiff from "@tabler/icons/outline/file-diff.svg?raw";

  const icons = {
    plus,
    send,
    pause,
    "at-sign": atSign,
    "log-in": logIn,
    "chevron-right": chevronRight,
    "chevron-left": chevronLeft,
    warning: warningTriangle,
    folder,
    computer,
    cloud,
    xmark,
    search,
    "sidebar-left-collapse": sidebarLeftCollapse,
    "sidebar-left-expand": sidebarLeftExpand,
    "sidebar-right-collapse": sidebarRightCollapse,
    "sidebar-right-expand": sidebarRightExpand,
    settings,
    "sun-light": sunLight,
    "half-moon": halfMoon,
    minus,
    square,
    network,
    server,
    laptop,
    devices,
    user,
    "media-image": mediaImage,
    palette,
    history,
    "corner-up-left": cornerUpLeft,
    "user-x": userX,
    "folder-open": folderOpen,
    "chevron-up": chevronUp,
    "layout-columns": layoutColumns,
    "message-circle": messageCircle,
    "alert-circle": alertCircle,
    "circle-check": circleCheck,
    "loader-2": loader2,
    archive,
    restore,
    star,
    "star-filled": starFilled,
    paperclip,
    "chevron-down": chevronDown,
    "layout-sidebar-right": layoutSidebarRight,
    "terminal-2": terminal2,
    "message-circle-plus": messageCirclePlus,
    "folder-cog": folderCog,
    "folder-plus": folderPlus,
    check,
    pencil,
    copy,
    unlink,
    trash,
    maximize,
    "contrast-2": contrast2,
    "question-mark": questionMark,
    "clipboard-list": clipboardList,
    "player-track-next": playerTrackNext,
    "file-text": fileText,
    "file-plus": filePlus,
    brain,
    tool,
    world,
    "arrow-narrow-up": arrowNarrowUp,
    "arrow-narrow-down": arrowNarrowDown,
    refresh,
    eye,
    bell,
    file,
    cpu,
    command,
    keyboard,
    "arrows-exchange": arrowsExchange,
    pin,
    pinned,
    "git-branch": gitBranch,
    clock,
    filter,
    "bell-filled": bellFilled,
    "chart-bar": chartBar,
    "info-circle": infoCircle,
    logout,
    selector,
    "clear-all": clearAll,
    "arrows-minimize": arrowsMinimize,
    "circle-x": circleX,
    "player-stop": playerStop,
    "player-play": playerPlay,
    "folder-code": folderCode,
    "folder-check": folderCheck,
    "folder-bolt": folderBolt,
    "folder-share": folderShare,
    "folder-star": folderStar,
    "folder-down": folderDown,
    "brand-npm": brandNpm,
    "brand-github": brandGithub,
    "brand-vscode": brandVscode,
    "brand-docker": brandDocker,
    "browser": browser,
    "arrows-diff": arrowsDiff,
    "robot": robot,
    "files": files,
    "arrow-left": arrowLeft,
    "arrow-right": arrowRight,
    "aspect-ratio": aspectRatio,
    "device-mobile": deviceMobile,
    "device-tablet": deviceTablet,
    "external-link": externalLink,
    "device-floppy": deviceFloppy,
    "git-commit": gitCommit,
    "file-diff": fileDiff,
    "arrow-back-up": arrowBackUp,
    "switch-horizontal": switchHorizontal,
    "layout-grid": layoutGrid,
    dots,
    code,
    "message-question": messageQuestion,
    "list-search": listSearch,
    "world-www": worldWww,
    "git-compare": gitCompare,
    checks: circleCheck2,
  };

  let { name, size = 16 }: { name: keyof typeof icons; size?: number } = $props();

  // rem, not px, so icons scale with Settings > Appearance > UI font size.
  const REM_BASE = 14;
</script>

<span class="icon" style="width: {size / REM_BASE}rem; height: {size / REM_BASE}rem;">
  {@html icons[name]}
</span>

<style>
  .icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    line-height: 0;
  }
  .icon :global(svg) {
    width: 100%;
    height: 100%;
  }
</style>
