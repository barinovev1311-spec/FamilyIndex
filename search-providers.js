// search-providers.js — SearchProvider из ТЗ. Каждый провайдер отвечает
// за один класс источников и умеет строить либо прямые ссылки (сейчас),
// либо (в будущем) реальный запрос через API. AI (DeepSeek) сюда не
// звонит напрямую — ResearchService использует провайдеров отдельно
// от генерации текста запросов.

function nameVariantsOf(person) {
  const forms = new Set();
  const push = (ln, fn, mn) => { const parts = [ln, fn, mn].filter(Boolean); if (parts.length) forms.add(parts.join(" ")); };
  push(person.lastName, person.firstName, person.middleName);
  if (person.maidenName) push(person.maidenName, person.firstName, person.middleName);
  (person.nameVariants || []).forEach((v) => v && forms.add(v));
  return [...forms];
}

class SearchProvider {
  constructor(name, note) { this.name = name; this.note = note; this.live = false; } // live=true когда провайдер реально сам выполняет запрос, а не даёт ссылку
  // возвращает [{name, url, note}] — набор ссылок для ручной проверки
  buildLinks(_person) { return []; }
}

class GeneralWebSearch extends SearchProvider {
  constructor() { super("GeneralWebSearch", "точечный запрос по имени, месту и году"); }
  buildLinks(person) {
    const names = nameVariantsOf(person);
    const primary = names[0] || "";
    const free = [primary, person.birthPlace].filter(Boolean).join(" ");
    if (!free) return [];
    const enc = encodeURIComponent(free);
    return [
      { name: "Google", url: `https://www.google.com/search?q=${enc}`, note: this.note },
      { name: "Яндекс", url: `https://yandex.ru/search/?text=${enc}`, note: "то же самое, другой поисковик" },
    ];
  }
}

class GenealogySearch extends SearchProvider {
  constructor() { super("GenealogySearch", "генеалогические архивы и базы"); }
  buildLinks(person) {
    const names = nameVariantsOf(person);
    const primary = names[0] || "";
    const [ln, fn] = primary.split(" ");
    const enc = encodeURIComponent;
    const links = [];
    if (ln) links.push({ name: "FamilySearch", url: `https://www.familysearch.org/search/record/results?q.surname=${enc(ln)}&q.givenName=${enc(fn || "")}`, note: "крупнейший бесплатный архив метрик и переписей" });
    if (primary) links.push({ name: "Geni", url: `https://www.geni.com/search?search_type=people&names=${enc(primary)}`, note: "база с уже построенными деревьями других людей" });
    if (primary) links.push({ name: "Wikidata", url: `https://www.wikidata.org/w/index.php?search=${enc(primary)}&title=Special:Search`, note: "публичные данные об исторических личностях" });
    return links;
  }
}

class MilitarySearch extends SearchProvider {
  constructor() { super("MilitarySearch", "документы о участниках Великой Отечественной войны"); }
  buildLinks(person) {
    const names = nameVariantsOf(person);
    const primary = names[0] || "";
    const [ln, fn, mn] = primary.split(" ");
    const enc = encodeURIComponent;
    return [
      { name: "Память народа", url: `https://pamyat-naroda.ru/heroes/?last_name=${enc(ln || "")}&first_name=${enc(fn || "")}&middle_name=${enc(mn || "")}`, note: this.note },
      { name: "ОБД «Мемориал»", url: `https://obd-memorial.ru/html/search.htm`, note: "потери и захоронения — форма поиска на сайте" },
    ];
  }
}

// Будущий провайдер: настоящий автопоиск через DeepSeek function calling +
// внешний поисковый API (Serper/Bing/Google Custom Search). Сейчас — только
// заглушка структуры, честно сообщает, что не подключён, а не притворяется.
class DeepSeekWebSearch extends SearchProvider {
  constructor() { super("DeepSeekWebSearch", "автоматический интернет-поиск (пока не подключён)"); }
  isAvailable() { return !!process.env.SEARCH_API_KEY; }
  buildLinks() { return []; }
  async search() {
    throw new Error("DeepSeekWebSearch ещё не подключён: нужен отдельный ключ поискового API (например, SEARCH_API_KEY для Serper.dev или Bing) в дополнение к DEEPSEEK_API_KEY.");
  }
}

const PROVIDERS = [new GenealogySearch(), new MilitarySearch(), new GeneralWebSearch(), new DeepSeekWebSearch()];

function buildAllLinks(person) {
  const out = [];
  PROVIDERS.forEach((p) => {
    const links = p.buildLinks(person);
    links.forEach((l) => out.push({ ...l, provider: p.name, live: p.live }));
  });
  return out;
}

module.exports = { SearchProvider, GeneralWebSearch, GenealogySearch, MilitarySearch, DeepSeekWebSearch, PROVIDERS, buildAllLinks };
