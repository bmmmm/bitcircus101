// storage.js — central localStorage wrapper for bitcircus101.
// Defines all known keys in one place and provides exception-safe get/set/remove.
// Load this before main.js, stage.js, projects.js.
(function () {
  "use strict";

  var KEYS = {
    THEME:        "bc.theme",
    SPEED:        "bc.speed",
    STAGE_OFF:    "bc.stage-off",
    SCENE:        "bc.scene",
    PROJECTS_TPL: "bc.projects-tpl",
    ASCII_DRAFT:  "bc.ascii-draft",
  };

  function get(k)    { try { return localStorage.getItem(k); }    catch (e) { return null; } }
  function set(k, v) { try { localStorage.setItem(k, v); }        catch (e) {} }
  function remove(k) { try { localStorage.removeItem(k); }        catch (e) {} }

  window.BC = window.BC || {};
  window.BC.storage = { KEYS: KEYS, get: get, set: set, remove: remove };
}());
