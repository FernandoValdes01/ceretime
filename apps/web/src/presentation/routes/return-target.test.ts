// @vitest-environment jsdom
import { beforeEach, describe, expect, test } from "vitest";
import {
  consumeReturnTarget,
  peekReturnTarget,
  persistReturnTarget,
  resolveReturnTarget,
} from "./return-target";

const STORAGE_KEY = "ceretime:post-login-redirect";

beforeEach(() => {
  sessionStorage.clear();
});

describe("resolveReturnTarget", () => {
  test("acepta una ruta interna del portal con query", () => {
    expect(resolveReturnTarget("/estudiante?tab=solicitudes")).toBe("/estudiante?tab=solicitudes");
  });

  test("descarta el hash para no arrastrar fragmentos", () => {
    expect(resolveReturnTarget("/estudiante#inicio")).toBe("/estudiante");
  });

  test("rechaza URLs absolutas, protocolo relativo y no texto", () => {
    expect(resolveReturnTarget("https://malicioso.test/estudiante")).toBe(null);
    expect(resolveReturnTarget("//malicioso.test/estudiante")).toBe(null);
    expect(resolveReturnTarget("estudiante")).toBe(null);
    expect(resolveReturnTarget("")).toBe(null);
    expect(resolveReturnTarget(undefined)).toBe(null);
    expect(resolveReturnTarget(null)).toBe(null);
  });

  test("rechaza el índice, el acceso y el denegado para evitar bucles", () => {
    expect(resolveReturnTarget("/")).toBe(null);
    expect(resolveReturnTarget("/login")).toBe(null);
    expect(resolveReturnTarget("/login?redirect=/estudiante")).toBe(null);
    expect(resolveReturnTarget("/denegado")).toBe(null);
    expect(resolveReturnTarget("/denegado/")).toBe(null);
  });
});

describe("persistencia del retorno", () => {
  test("guarda, previsualiza y consume una sola vez", () => {
    persistReturnTarget("/estudiante");
    expect(peekReturnTarget()).toBe("/estudiante");
    expect(consumeReturnTarget()).toBe("/estudiante");
    expect(peekReturnTarget()).toBe(null);
    expect(sessionStorage.getItem(STORAGE_KEY)).toBe(null);
  });

  test("un valor inválido limpia el retorno anterior", () => {
    persistReturnTarget("/estudiante");
    persistReturnTarget("/login");
    expect(peekReturnTarget()).toBe(null);
  });
});
