<script lang="ts">
  // Tabler Icons (https://tabler.io/icons), outline set, inlined at build
  // time via Vite's `?raw` loader so they inherit color like text (all
  // strokes are `currentColor`). No wrapper icon library — this is the whole
  // binding.
  import plus from "@tabler/icons/outline/plus.svg?raw";
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
  };

  let { name, size = 16 }: { name: keyof typeof icons; size?: number } = $props();

  // In rem, not px, so every icon in the app scales with Settings > Appearance
  // > UI font size (root font-size is that value — see app.css) instead of
  // staying a fixed pixel size while surrounding text and spacing grow.
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
