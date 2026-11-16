import { createSignal, onCleanup, Show } from "solid-js"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { useI18n, type UiI18nKey } from "@opencode-ai/ui/context/i18n"
import { TooltipV2 } from "@opencode-ai/ui/v2/tooltip-v2"
import {
  createDictation,
  DICTATION_LANGUAGE_KEY,
  dictationLanguage,
  insertDictatedText,
  nextDictationLanguage,
  type DictationFatalError,
} from "./dictation"

const ERROR_KEYS = {
  "not-allowed": "ui.promptInput.dictateError.notAllowed",
  "service-not-allowed": "ui.promptInput.dictateError.serviceNotAllowed",
  "audio-capture": "ui.promptInput.dictateError.audioCapture",
  "language-not-supported": "ui.promptInput.dictateError.languageNotSupported",
  network: "ui.promptInput.dictateError.network",
} as const satisfies Record<DictationFatalError, UiI18nKey>

function storage() {
  try {
    return window.localStorage
  } catch {
    return undefined
  }
}

/**
 * Buton de dictare vocala (microfon + limba) pentru caseta de mesaj.
 * Textul recunoscut e inserat la cursor in `editor`, ca si cum ar fi fost tastat.
 * Nu apare in browsere fara Web Speech API (ex. Firefox).
 */
export function PromptInputV2DictationButton(props: { editor: () => HTMLElement | undefined; disabled?: boolean }) {
  const i18n = useI18n()
  const [language, setLanguage] = createSignal(dictationLanguage(storage()))
  const [listening, setListening] = createSignal(false)
  const [interim, setInterim] = createSignal("")
  const [error, setError] = createSignal<DictationFatalError>()

  const dictation = createDictation({
    language: () => language().code,
    onText: (text) => {
      const editor = props.editor()
      if (editor) insertDictatedText(editor, text)
    },
    onInterim: setInterim,
    onListening: (on) => {
      setListening(on)
      if (on) setError(undefined)
    },
    onError: setError,
  })
  onCleanup(() => dictation.stop())

  const switchLanguage = () => {
    const next = nextDictationLanguage(language().code)
    setLanguage(next)
    storage()?.setItem(DICTATION_LANGUAGE_KEY, next.code)
    dictation.restart()
  }
  // Butoanele nu iau focusul din caseta, altfel textul dictat ar ajunge in alt loc.
  const keepEditorFocus = (event: MouseEvent) => event.preventDefault()
  const note = () => {
    const code = error()
    if (code) return i18n.t(ERROR_KEYS[code])
    if (!listening()) return ""
    return `🎤 ${interim() || i18n.t("ui.promptInput.dictateListening")}`
  }

  return (
    <Show when={dictation.supported}>
      <div class="flex items-center gap-1 pr-1">
        <Show when={note()}>
          <div
            data-slot="dictation-note"
            role="status"
            class="pointer-events-none absolute right-2 bottom-12 z-20 max-w-[70%] rounded-md px-2 py-1 text-[12px] leading-4 shadow-lg"
            style={{ background: error() ? "#991b1b" : "#1f2937", color: "#f9fafb", "white-space": "pre-wrap" }}
          >
            {note()}
          </div>
        </Show>
        <TooltipV2 placement="top" value={i18n.t("ui.promptInput.dictateLanguage", { language: language().name })}>
          <button
            type="button"
            data-action="prompt-dictate-language"
            class="h-7 rounded-md px-1.5 text-[11px] font-semibold tracking-wide text-v2-text-text-faint hover:bg-black/5 focus-visible:outline-2"
            disabled={props.disabled}
            aria-label={i18n.t("ui.promptInput.dictateLanguage", { language: language().name })}
            onMouseDown={keepEditorFocus}
            onClick={switchLanguage}
          >
            {language().label}
          </button>
        </TooltipV2>
        <TooltipV2
          placement="top"
          value={listening() ? i18n.t("ui.promptInput.dictateStop") : i18n.t("ui.promptInput.dictate")}
        >
          <IconButton
            data-action="prompt-dictate"
            type="button"
            icon="microphone"
            variant="ghost"
            class="size-7 rounded-md p-[6px]"
            classList={{ "animate-pulse": listening() }}
            style={listening() ? { background: "#dc2626", color: "#ffffff" } : undefined}
            disabled={props.disabled}
            aria-pressed={listening()}
            aria-label={listening() ? i18n.t("ui.promptInput.dictateStop") : i18n.t("ui.promptInput.dictate")}
            onMouseDown={keepEditorFocus}
            onClick={dictation.toggle}
          />
        </TooltipV2>
      </div>
    </Show>
  )
}
