// history-ru.js — курируемый (не сгенерированный ИИ) список значимых
// событий истории России и мира, 1870–2026. Используется как фоновый
// слой на «Хронологии» — специально ограничен действительно крупными
// событиями (войны, революции, смены границ, переселения, репрессии,
// эпидемии, голод), чтобы не захламлять шкалу.
//
// scope: 'world' | 'country' | 'region' — для разной визуальной подачи.

window.HISTORY_EVENTS = [
  { year: 1877, scope: "country", icon: "⚔️", title: "Русско-турецкая война (1877–1878)" },
  { year: 1891, scope: "country", icon: "🌾", title: "Голод в Российской империи (1891–1892)" },
  { year: 1904, scope: "country", icon: "⚔️", title: "Русско-японская война (1904–1905)" },
  { year: 1905, scope: "country", icon: "🏛️", title: "Революция 1905 года" },
  { year: 1914, scope: "world", icon: "🌍", title: "Начало Первой мировой войны" },
  { year: 1917, scope: "country", icon: "🇷🇺", title: "Февральская и Октябрьская революции" },
  { year: 1918, scope: "country", icon: "⚔️", title: "Начало Гражданской войны в России" },
  { year: 1921, scope: "country", icon: "🌾", title: "Голод в Поволжье (1921–1922)" },
  { year: 1922, scope: "country", icon: "🏛️", title: "Образование СССР" },
  { year: 1929, scope: "country", icon: "🏛️", title: "Начало массовой коллективизации" },
  { year: 1932, scope: "country", icon: "🌾", title: "Голод 1932–1933 годов" },
  { year: 1937, scope: "country", icon: "⚠️", title: "Пик массовых репрессий («Большой террор»)" },
  { year: 1939, scope: "world", icon: "🌍", title: "Начало Второй мировой войны" },
  { year: 1941, scope: "country", icon: "🇷🇺", title: "Начало Великой Отечественной войны" },
  { year: 1942, scope: "region", icon: "⚔️", title: "Сталинградская битва" },
  { year: 1945, scope: "world", icon: "🌍", title: "Окончание Второй мировой войны" },
  { year: 1947, scope: "country", icon: "🏛️", title: "Отмена карточной системы в СССР" },
  { year: 1953, scope: "country", icon: "🏛️", title: "Смерть Сталина, начало «оттепели»" },
  { year: 1956, scope: "country", icon: "🏛️", title: "XX съезд КПСС, разоблачение культа личности" },
  { year: 1961, scope: "world", icon: "🚀", title: "Первый полёт человека в космос" },
  { year: 1985, scope: "country", icon: "🏛️", title: "Начало Перестройки" },
  { year: 1986, scope: "region", icon: "⚠️", title: "Авария на Чернобыльской АЭС" },
  { year: 1991, scope: "country", icon: "🇷🇺", title: "Распад СССР" },
  { year: 1998, scope: "country", icon: "⚠️", title: "Экономический кризис (дефолт) 1998 года" },
  { year: 2008, scope: "world", icon: "🌍", title: "Мировой финансовый кризис" },
  { year: 2014, scope: "country", icon: "🏛️", title: "Присоединение Крыма к России" },
  { year: 2020, scope: "world", icon: "🦠", title: "Пандемия COVID-19" },
  { year: 2022, scope: "country", icon: "⚔️", title: "Начало военных действий на Украине" },
];
