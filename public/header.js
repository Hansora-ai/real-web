(function () {
  'use strict';

  const SUPABASE_URL = 'https://qmaealblegvcwodlmeht.supabase.co';
  const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFtYWVhbGJsZWd2Y3dvZGxtZWh0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTg2MjkzNzMsImV4cCI6MjA3NDIwNTM3M30.bUV6W0zBtkd_6gtfPGBSpskybUmpLC-1znljoDpYy4c';
  const LOGO_URL = 'https://qmaealblegvcwodlmeht.supabase.co/storage/v1/object/public/website%20content/Untitled%20design%20(23).png';
  const CACHE_PREFIX = 'hansora.header.';
  const AFFILIATE_REF_KEY = 'hansora_affiliate_ref';
  const AFFILIATE_PENDING_KEY = 'hansora_pending_affiliate_ref';
  const AFFILIATE_DONE_PREFIX = 'hansora_affiliate_registered.';
  const AFFILIATE_COOKIE_NAME = 'hansora_affiliate_ref';
  const AFFILIATE_REF_MAX_AGE = 60 * 60 * 24 * 30;
  const SIGNUP_OFFER_DELAY_MS = 3 * 60 * 1000;
  const SIGNUP_OFFER_PENDING_PREFIX = 'hansora_signup_offer_pending.';
  const SIGNUP_OFFER_DISMISSED_PREFIX = 'hansora_signup_offer_dismissed.';
  const SIGNUP_OFFER_OAUTH_STARTED_KEY = 'hansora_signup_offer_oauth_started_at';
  const SIGNUP_OFFER_URL = '/pricing.html?offer_popup=1';
  const AI_COURSE_ORIGIN_KEY = 'hansora.ai_course.origin.v2';
  const AI_COURSE_PENDING_ORIGIN_KEY = 'hansora.ai_course.pending_origin.v2';
  const AI_COURSE_SKIP_CAPTURE_KEY = 'hansora.ai_course.skip_next_capture';
  const SIGNUP_ATTRIBUTION_PENDING_KEY = 'hansora.signup_attribution.pending.v1';
  const SIGNUP_ATTRIBUTION_MAX_AGE_MS = 6 * 60 * 60 * 1000;
  const AUTH_FUNNEL_PENDING_KEY = 'hansora.auth_funnel.pending.v1';
  const AUTH_FUNNEL_MAX_AGE_MS = 30 * 60 * 1000;
  const AUTH_CALLBACK_SEARCH_SNAPSHOT = window.location.search || '';
  const AUTH_CALLBACK_HASH_SNAPSHOT = window.location.hash || '';
  const AUTH_CALLBACK_REFERRER_SNAPSHOT = document.referrer || '';
  const TELEGRAM_OAUTH_STARTED_KEY = 'hansora.telegram_oauth.started.v1';
  let aiCourseOriginCaptureDone = false;
  const GROK_VIDEO_CREDIT_THRESHOLD = 4;
  const SUBSCRIPTION_CACHE_MS = 60 * 1000;
  const SUBSCRIPTION_PLAN_RULES = {
    premium_monthly: [
      { key: 'nano-banana-2-lite', label: 'Nano Banana 2 Lite', type: 'image', models: ['nano-banana-2-lite', 'nano banana 2 lite'] },
      { key: 'nano-banana-2:1k', label: 'Nano Banana 2', type: 'image', models: ['nano-banana-2', 'nano banana 2'], qualities: ['1k'] },
      { key: 'z-image', label: 'Z Image', type: 'image', models: ['z-image', 'z image'] },
      { key: 'gpt-image-2:1k', label: 'GPT Image 2', type: 'image', models: ['gpt-image-2', 'gpt image 2'], qualities: ['1k'] },
      { key: 'seedream-5-lite', label: 'Seedream 5.0 Lite', type: 'image', models: ['seedream-5-lite', 'seedream 5 lite', 'seedream 5.0 lite'] },
      { key: 'grok-image', label: 'Grok Image', type: 'image', models: ['grok-image', 'grok image'] },
      { key: 'qwen-2', label: 'Qwen 2', type: 'image', models: ['qwen-2', 'qwen 2'] },
      { key: 'grok-video:6s', label: 'Grok Video', type: 'video', models: ['grok-video', 'grok video', 'grok'], durations: [6] }
    ],
    pro_monthly: [
      { key: 'nano-banana-2-lite', label: 'Nano Banana 2 Lite', type: 'image', models: ['nano-banana-2-lite', 'nano banana 2 lite'] },
      { key: 'nano-banana-2:1k', label: 'Nano Banana 2', type: 'image', models: ['nano-banana-2', 'nano banana 2'], qualities: ['1k'] },
      { key: 'z-image', label: 'Z Image', type: 'image', models: ['z-image', 'z image'] },
      { key: 'gpt-image-2:1k', label: 'GPT Image 2', type: 'image', models: ['gpt-image-2', 'gpt image 2'], qualities: ['1k'] },
      { key: 'seedream-5-lite', label: 'Seedream 5.0 Lite', type: 'image', models: ['seedream-5-lite', 'seedream 5 lite', 'seedream 5.0 lite'] },
      { key: 'grok-image', label: 'Grok Image', type: 'image', models: ['grok-image', 'grok image'] },
      { key: 'qwen-2', label: 'Qwen 2', type: 'image', models: ['qwen-2', 'qwen 2'] },
      { key: 'grok-video:6s', label: 'Grok Video', type: 'video', models: ['grok-video', 'grok video', 'grok'], durations: [6] },
      { key: 'veo-3-1-lite:720p:8s', label: 'Veo 3.1 Lite', type: 'video', models: ['veo31-lite', 'veo3_lite', 'veo-3-1-lite', 'veo 3.1 lite'], resolutions: ['720p'], durations: [8] }
    ],
    pro_max_monthly: [
      { key: 'nano-banana-2-lite', label: 'Nano Banana 2 Lite', type: 'image', models: ['nano-banana-2-lite', 'nano banana 2 lite'] },
      { key: 'nano-banana-2:1k', label: 'Nano Banana 2', type: 'image', models: ['nano-banana-2', 'nano banana 2'], qualities: ['1k'] },
      { key: 'nano-banana-2:2k', label: 'Nano Banana 2', type: 'image', models: ['nano-banana-2', 'nano banana 2'], qualities: ['2k'] },
      { key: 'z-image', label: 'Z Image', type: 'image', models: ['z-image', 'z image'] },
      { key: 'gpt-image-2:1k', label: 'GPT Image 2', type: 'image', models: ['gpt-image-2', 'gpt image 2'], qualities: ['1k'] },
      { key: 'gpt-image-2:2k', label: 'GPT Image 2', type: 'image', models: ['gpt-image-2', 'gpt image 2'], qualities: ['2k'] },
      { key: 'seedream-5-lite', label: 'Seedream 5.0 Lite', type: 'image', models: ['seedream-5-lite', 'seedream 5 lite', 'seedream 5.0 lite'] },
      { key: 'grok-image', label: 'Grok Image', type: 'image', models: ['grok-image', 'grok image'] },
      { key: 'qwen-2', label: 'Qwen 2', type: 'image', models: ['qwen-2', 'qwen 2'] },
      { key: 'wan-2-7-image', label: 'Wan 2.7 Image', type: 'image', models: ['wan-2-7', 'wan 2.7', 'wan-2-7-image', 'wan 2.7 image'] },
      { key: 'grok-video:6s', label: 'Grok Video', type: 'video', models: ['grok-video', 'grok video', 'grok'], durations: [6] },
      { key: 'veo-3-1-lite:720p:8s', label: 'Veo 3.1 Lite', type: 'video', models: ['veo31-lite', 'veo3_lite', 'veo-3-1-lite', 'veo 3.1 lite'], resolutions: ['720p'], durations: [8] },
      { key: 'veo-3-1-lite:1080p:8s', label: 'Veo 3.1 Lite', type: 'video', models: ['veo31-lite', 'veo3_lite', 'veo-3-1-lite', 'veo 3.1 lite'], resolutions: ['1080p'], durations: [8] },
      { key: 'kling-2-5-turbo:1080p:5s', label: 'Kling 2.5 Turbo', type: 'video', models: ['kling-2-5-turbo', 'kling 2.5 turbo'], resolutions: ['1080p'], durations: [5] }
    ]
  };

  function ensureI18nRuntime() {
    if (window.HansoraI18n || document.querySelector('script[data-hansora-i18n]')) return;
    const script = document.createElement('script');
    script.src = '/i18n.js';
    script.defer = true;
    script.dataset.hansoraI18n = '1';
    document.head.appendChild(script);
  }

  const LANGUAGE_STORAGE_KEY = 'hansora.language.v1';
  const LANGUAGE_SUFFIX = { en: '', hy: '_arm', ru: '_ru' };
  const LANGUAGE_META = {
    en: { name: 'English', flag: '🇬🇧', htmlLang: 'en' },
    hy: { name: 'Հայերեն', flag: '🇦🇲', htmlLang: 'hy' },
    ru: { name: 'Русский', flag: '🇷🇺', htmlLang: 'ru' }
  };

  function detectPageLanguage() {
    let pathname = '';
    try { pathname = decodeURIComponent(location.pathname || ''); } catch (_) { pathname = location.pathname || ''; }
    if (/(?:_arm\.html|\/course_arm\/?$)/i.test(pathname)) return 'hy';
    if (/(?:_ru\.html|\/course_ru\/?$)/i.test(pathname)) return 'ru';
    const declared = String(document.documentElement.lang || '').toLowerCase();
    if (declared === 'hy' || declared.indexOf('hy-') === 0) return 'hy';
    if (declared === 'ru' || declared.indexOf('ru-') === 0) return 'ru';
    return 'en';
  }

  const CURRENT_LANGUAGE = detectPageLanguage();

  const HEADER_COPY = {
    en: {
      home: 'HANSORA AI home', primaryNav: 'Primary navigation', image: 'Image', imageMenu: 'Image tools and models', imageSection: 'Image models and tools',
      video: 'Video', videoMenu: 'Video models', features: 'Features', featureMenu: 'Feature tools', imageTools: 'Image tools', videoAudioTools: 'Video and audio tools',
      audio: 'Audio', audioTools: 'Audio tools', pricing: 'Pricing', pricingAria: 'Pricing, 30% off', discount: '30% OFF', login: 'Login', openAccount: 'Open account menu',
      startCreating: 'Start creating', profile: 'Profile', history: 'History', credits: 'Credits', aiCourse: 'AI Course', logout: 'Logout', language: 'Language',
      closeCourse: 'Close course selection', courseEyebrow: 'Hansora AI Course', courseTitle: 'Choose your course language', courseIntro: 'Select the language in which you would like to study.',
      closeLanguage: 'Close language selection', languageEyebrow: 'Hansora language', languageTitle: 'Choose website language', languageIntro: 'Select the language for this page and every Hansora menu and popup.', current: 'Current',
      logIn: 'Log in', createAccount: 'Create your account', google: 'Continue with Google', telegram: 'Continue with Telegram', secureAuth: 'Continue securely with Google or Telegram. Telegram may not share an email address.',
      or: 'or', email: 'Email', password: 'Password', signUp: 'Sign up', analyticsAria: 'Analytics preferences', analyticsQuestion: 'Allow anonymous analytics?', analyticsNotice: 'We use anonymous analytics. Reject to stop.',
      reject: 'Reject', acceptAnalytics: 'Accept analytics', continue: 'Continue', telegramFailure: 'Telegram login was not completed', telegramCancelled: 'Telegram login was cancelled or not completed. Please try again.',
      creatorOffer: 'Creator discount offer', pricingOffer: 'Hansora pricing offer', closeOffer: 'Close offer', openingGoogle: 'Opening Google login…', googleFailed: 'Google login failed.',
      openingTelegram: 'Opening Telegram login…', tryAgain: 'Please try again.', enterCredentials: 'Enter email & password.', signingIn: 'Signing in…', loginFailed: 'Login failed.', notLoggedIn: 'Not logged in', notEnoughCredits: 'Not enough credits'
    },
    hy: {
      home: 'HANSORA AI գլխավոր էջ', primaryNav: 'Հիմնական նավիգացիա', image: 'Պատկեր', imageMenu: 'Պատկերի գործիքներ և մոդելներ', imageSection: 'Պատկերի մոդելներ և գործիքներ',
      video: 'Տեսանյութ', videoMenu: 'Տեսանյութի մոդելներ', features: 'Գործիքներ', featureMenu: 'Լրացուցիչ գործիքներ', imageTools: 'Պատկերի գործիքներ', videoAudioTools: 'Տեսանյութի և ձայնի գործիքներ',
      audio: 'Ձայն', audioTools: 'Ձայնային գործիքներ', pricing: 'Գներ', pricingAria: 'Գներ՝ 30% զեղչով', discount: '30% ԶԵՂՉ', login: 'Մուտք', openAccount: 'Բացել հաշվի ընտրացանկը',
      startCreating: 'Սկսել ստեղծել', profile: 'Պրոֆիլ', history: 'Պատմություն', credits: 'Կրեդիտներ', aiCourse: 'AI դասընթաց', logout: 'Դուրս գալ', language: 'Լեզու',
      closeCourse: 'Փակել դասընթացի լեզվի ընտրությունը', courseEyebrow: 'Hansora AI դասընթաց', courseTitle: 'Ընտրեք դասընթացի լեզուն', courseIntro: 'Ընտրեք, թե որ լեզվով եք ցանկանում սովորել։',
      closeLanguage: 'Փակել լեզվի ընտրությունը', languageEyebrow: 'Hansora-ի լեզու', languageTitle: 'Ընտրեք կայքի լեզուն', languageIntro: 'Ընտրեք այս էջի, Hansora-ի ընտրացանկերի և պատուհանների լեզուն։', current: 'Ընտրված',
      logIn: 'Մուտք գործել', createAccount: 'Ստեղծեք ձեր հաշիվը', google: 'Շարունակել Google-ով', telegram: 'Շարունակել Telegram-ով', secureAuth: 'Անվտանգ շարունակեք Google-ով կամ Telegram-ով։ Telegram-ը կարող է չտրամադրել էլփոստի հասցե։',
      or: 'կամ', email: 'Էլփոստ', password: 'Գաղտնաբառ', signUp: 'Գրանցվել', analyticsAria: 'Վերլուծական տվյալների կարգավորումներ', analyticsQuestion: 'Թույլատրե՞լ անանուն վերլուծությունը։', analyticsNotice: 'Մենք օգտագործում ենք անանուն վերլուծություն։ Դադարեցնելու համար մերժեք։',
      reject: 'Մերժել', acceptAnalytics: 'Թույլատրել', continue: 'Շարունակել', telegramFailure: 'Telegram-ով մուտքը չի ավարտվել', telegramCancelled: 'Telegram-ով մուտքը չեղարկվել կամ չի ավարտվել։ Փորձեք կրկին։',
      creatorOffer: 'Զեղչային առաջարկ ստեղծողների համար', pricingOffer: 'Hansora-ի գնային առաջարկ', closeOffer: 'Փակել առաջարկը', openingGoogle: 'Բացվում է Google-ով մուտքը…', googleFailed: 'Google-ով մուտքը ձախողվեց։',
      openingTelegram: 'Բացվում է Telegram-ով մուտքը…', tryAgain: 'Փորձեք կրկին։', enterCredentials: 'Մուտքագրեք էլփոստը և գաղտնաբառը։', signingIn: 'Մուտք է կատարվում…', loginFailed: 'Մուտքը ձախողվեց։', notLoggedIn: 'Մուտք չեք գործել', notEnoughCredits: 'Բավարար կրեդիտներ չկան'
    },
    ru: {
      home: 'Главная страница HANSORA AI', primaryNav: 'Основная навигация', image: 'Изображения', imageMenu: 'Инструменты и модели изображений', imageSection: 'Модели и инструменты изображений',
      video: 'Видео', videoMenu: 'Видеомодели', features: 'Инструменты', featureMenu: 'Дополнительные инструменты', imageTools: 'Инструменты для изображений', videoAudioTools: 'Инструменты для видео и аудио',
      audio: 'Аудио', audioTools: 'Аудиоинструменты', pricing: 'Цены', pricingAria: 'Цены со скидкой 30%', discount: 'СКИДКА 30%', login: 'Войти', openAccount: 'Открыть меню аккаунта',
      startCreating: 'Начать создавать', profile: 'Профиль', history: 'История', credits: 'Кредиты', aiCourse: 'AI-курс', logout: 'Выйти', language: 'Язык',
      closeCourse: 'Закрыть выбор языка курса', courseEyebrow: 'AI-курс Hansora', courseTitle: 'Выберите язык курса', courseIntro: 'Выберите язык, на котором хотите проходить обучение.',
      closeLanguage: 'Закрыть выбор языка', languageEyebrow: 'Язык Hansora', languageTitle: 'Выберите язык сайта', languageIntro: 'Выберите язык этой страницы, меню и всех окон Hansora.', current: 'Выбрано',
      logIn: 'Войти', createAccount: 'Создайте аккаунт', google: 'Продолжить с Google', telegram: 'Продолжить с Telegram', secureAuth: 'Безопасно продолжите с Google или Telegram. Telegram может не передавать адрес электронной почты.',
      or: 'или', email: 'Эл. почта', password: 'Пароль', signUp: 'Зарегистрироваться', analyticsAria: 'Настройки аналитики', analyticsQuestion: 'Разрешить анонимную аналитику?', analyticsNotice: 'Мы используем анонимную аналитику. Нажмите «Отклонить», чтобы остановить сбор.',
      reject: 'Отклонить', acceptAnalytics: 'Разрешить', continue: 'Продолжить', telegramFailure: 'Вход через Telegram не завершён', telegramCancelled: 'Вход через Telegram отменён или не завершён. Попробуйте ещё раз.',
      creatorOffer: 'Скидочное предложение для создателей', pricingOffer: 'Ценовое предложение Hansora', closeOffer: 'Закрыть предложение', openingGoogle: 'Открывается вход через Google…', googleFailed: 'Не удалось войти через Google.',
      openingTelegram: 'Открывается вход через Telegram…', tryAgain: 'Попробуйте ещё раз.', enterCredentials: 'Введите эл. почту и пароль.', signingIn: 'Выполняется вход…', loginFailed: 'Не удалось войти.', notLoggedIn: 'Вход не выполнен', notEnoughCredits: 'Недостаточно кредитов'
    }
  };

  const NOTE_TRANSLATIONS = {
    hy: { 'Latest image generation':'Պատկերների նորագույն գեներացում','Fast image edits':'Պատկերների արագ խմբագրում','Low-cost 1K image edits':'Մատչելի 1K պատկերների խմբագրում','Pro image generation':'Պրոֆեսիոնալ պատկերների գեներացում','Pro controlled image edits':'Պրոֆեսիոնալ վերահսկվող խմբագրում','Light creative images':'Արագ ստեղծագործական պատկերներ','Stylized image model':'Ոճավորված պատկերների մոդել','Image generator':'Պատկերների գեներացում','Image and frame work':'Պատկերների և կադրերի ստեղծում','Image generation':'Պատկերների գեներացում','Creative image model':'Ստեղծագործական պատկերների մոդել','OpenAI image model':'OpenAI-ի պատկերների մոդել','Image editing':'Պատկերների խմբագրում','Increase image quality':'Բարձրացնել պատկերի որակը','Different angles chosen':'Ստեղծել տարբեր դիտանկյուններ','Extend image edges':'Ընդլայնել պատկերի եզրերը','Character creator':'Կերպարների ստեղծում','Product selling cards':'Վաճառող ապրանքային քարտեր','Cartoon prompt builder':'Մուլտֆիլմի prompt-ների ստեղծում','Cinematic video model':'Կինեմատոգրաֆիկ տեսանյութերի մոդել','Advanced video generation':'Տեսանյութերի առաջադեմ գեներացում','Fast cinematic video model':'Արագ կինեմատոգրաֆիկ տեսանյութերի մոդել','Fast text or image video model':'Տեքստից կամ պատկերից արագ տեսանյութ','Prompt, image, and video inputs':'Prompt, պատկեր և տեսանյութ որպես մուտքային տվյալներ','Edit uploaded video':'Խմբագրել ներբեռնված տեսանյութը','Change video background':'Փոխել տեսանյութի ֆոնը','Change video lighting':'Փոխել տեսանյութի լուսավորությունը','Video and audio model':'Տեսանյութի և ձայնի մոդել','Google video model':'Google-ի տեսանյութերի մոդել','Cinematic video':'Կինեմատոգրաֆիկ տեսանյութ','Video with sound':'Ձայնով տեսանյութ','Fast Kling video model':'Kling-ի արագ տեսանյութերի մոդել','First and last frame control':'Առաջին և վերջին կադրերի կառավարում','Motion transfer':'Շարժման փոխանցում','Video transformation':'Տեսանյութի ձևափոխում','Increase video quality':'Բարձրացնել տեսանյութի որակը','Talking avatar video':'Խոսող avatar տեսանյութ','Add your kid in cartoon':'Ավելացնել ձեր երեխային մուլտֆիլմում','Generate voice from text':'Տեքստից ձայն գեներացնել','Separate clean vocals':'Առանձնացնել մաքուր վոկալը','Transform a voice':'Փոխակերպել ձայնը','Create music tracks':'Ստեղծել երաժշտական թրեքեր','Analyse hooks and ideas':'Վերլուծել հուկերն ու գաղափարները' },
    ru: { 'Latest image generation':'Новейшая генерация изображений','Fast image edits':'Быстрое редактирование изображений','Low-cost 1K image edits':'Доступное редактирование изображений 1K','Pro image generation':'Профессиональная генерация изображений','Pro controlled image edits':'Профессиональное управляемое редактирование','Light creative images':'Быстрые креативные изображения','Stylized image model':'Модель для стилизованных изображений','Image generator':'Генерация изображений','Image and frame work':'Работа с изображениями и кадрами','Image generation':'Генерация изображений','Creative image model':'Креативная модель изображений','OpenAI image model':'Модель изображений OpenAI','Image editing':'Редактирование изображений','Increase image quality':'Повысить качество изображения','Different angles chosen':'Создать разные ракурсы','Extend image edges':'Расширить границы изображения','Character creator':'Создание персонажей','Product selling cards':'Продающие карточки товаров','Cartoon prompt builder':'Создание prompt для мультфильмов','Cinematic video model':'Модель кинематографичного видео','Advanced video generation':'Продвинутая генерация видео','Fast cinematic video model':'Быстрая модель кинематографичного видео','Fast text or image video model':'Быстрое видео из текста или изображения','Prompt, image, and video inputs':'Prompt, изображение и видео на входе','Edit uploaded video':'Редактировать загруженное видео','Change video background':'Изменить фон видео','Change video lighting':'Изменить освещение видео','Video and audio model':'Модель видео и аудио','Google video model':'Видеомодель Google','Cinematic video':'Кинематографичное видео','Video with sound':'Видео со звуком','Fast Kling video model':'Быстрая видеомодель Kling','First and last frame control':'Управление первым и последним кадрами','Motion transfer':'Перенос движения','Video transformation':'Преобразование видео','Increase video quality':'Повысить качество видео','Talking avatar video':'Видео с говорящим avatar','Add your kid in cartoon':'Добавить ребёнка в мультфильм','Generate voice from text':'Генерировать голос из текста','Separate clean vocals':'Отделить чистый вокал','Transform a voice':'Преобразовать голос','Create music tracks':'Создавать музыкальные треки','Analyse hooks and ideas':'Анализировать хуки и идеи' }
  };

  function copy(key) {
    return (HEADER_COPY[CURRENT_LANGUAGE] && HEADER_COPY[CURRENT_LANGUAGE][key]) || HEADER_COPY.en[key] || key;
  }

  function translatedNote(note) {
    return (NOTE_TRANSLATIONS[CURRENT_LANGUAGE] && NOTE_TRANSLATIONS[CURRENT_LANGUAGE][note]) || note;
  }

  function localizedHref(href, language) {
    const lang = LANGUAGE_SUFFIX[language] != null ? language : CURRENT_LANGUAGE;
    if (!href || href.charAt(0) === '#' || /^(?:mailto:|tel:|javascript:|data:)/i.test(href)) return href;
    try {
      const base = location.href || 'https://hansora.co/index.html';
      const url = new URL(href, base);
      if (url.origin !== location.origin) return href;
      let pathname = url.pathname || '/';
      if (pathname === '/') pathname = '/index.html';
      if (/\/(?:course_arm|course_ru)\/?$/i.test(pathname) || !/\.html$/i.test(pathname)) {
        return location.protocol === 'file:' ? url.href : `${pathname}${url.search}${url.hash}`;
      }
      pathname = pathname.replace(/_(?:arm|ru)(?=\.html$)/i, '');
      pathname = pathname.replace(/\.html$/i, `${LANGUAGE_SUFFIX[lang]}.html`);
      url.pathname = pathname;
      return location.protocol === 'file:' ? url.href : `${url.pathname}${url.search}${url.hash}`;
    } catch (_) {
      return href;
    }
  }

  function siteHref(href, language) {
    return withAffiliateRef(localizedHref(href, language));
  }

  function oauthReturnUrl() {
    const target = localizedHref('/index.html');
    try { return new URL(target, location.origin).href; } catch (_) { return `${location.origin}${target}`; }
  }

  let sb = null;
  let currentUser = null;
  let currentCredits = 0;
  let signupOfferTimer = null;
  let currentSubscription = null;
  let subscriptionLoadedAt = 0;
  let subscriptionUserId = null;
  let subscriptionPromise = null;
  let authCallbackArrivalWrite = Promise.resolve(false);

  const IMAGE_MENU_MODELS = [
    { label: 'GPT Image 2', id: 'gpt-image-2', icon: 'G2', logoUrl: 'https://qmaealblegvcwodlmeht.supabase.co/storage/v1/object/public/website%20content/LOGOS/2.png', note: 'Latest image generation' },
    { label: 'Nano Banana 2', id: 'nano-banana-2', icon: 'N2', logoUrl: 'https://qmaealblegvcwodlmeht.supabase.co/storage/v1/object/public/website%20content/LOGOS/13.png', note: 'Fast image edits' },
    { label: 'Nano Banana 2 Lite', id: 'nano-banana-2-lite', icon: 'NL', logoUrl: 'https://qmaealblegvcwodlmeht.supabase.co/storage/v1/object/public/website%20content/LOGOS/13.png', note: 'Low-cost 1K image edits' },
    { label: 'Nano Banana Pro', id: 'nano-banana-pro', icon: 'NP', logoUrl: 'https://qmaealblegvcwodlmeht.supabase.co/storage/v1/object/public/website%20content/LOGOS/13.png', note: 'Pro image generation' },
    { label: 'Seedream 5.0 Pro', id: 'seedream-5-pro', icon: 'SP', logoUrl: 'https://qmaealblegvcwodlmeht.supabase.co/storage/v1/object/public/website%20content/LOGOS/5.png', note: 'Pro controlled image edits' },
    { label: 'Seedream 5.0 Lite', id: 'seedream-5-lite', icon: 'S', logoUrl: 'https://qmaealblegvcwodlmeht.supabase.co/storage/v1/object/public/website%20content/LOGOS/5.png', note: 'Light creative images' },
    { label: 'Grok Image', id: 'grok-image', icon: 'X', logoUrl: 'https://qmaealblegvcwodlmeht.supabase.co/storage/v1/object/public/website%20content/LOGOS/4.png', note: 'Stylized image model' },
    { label: 'Seedream 4.5', id: 'seedream-4-5', icon: 'S4', logoUrl: 'https://qmaealblegvcwodlmeht.supabase.co/storage/v1/object/public/website%20content/LOGOS/5.png', note: 'Image generator' },
    { label: 'Wan 2.7', id: 'wan-2-7', icon: 'W', logoUrl: 'https://qmaealblegvcwodlmeht.supabase.co/storage/v1/object/public/website%20content/LOGOS/6.png', note: 'Image and frame work' },
    { label: 'Qwen 2', id: 'qwen-2', icon: 'Q2', logoUrl: 'https://qmaealblegvcwodlmeht.supabase.co/storage/v1/object/public/website%20content/LOGOS/6.png', note: 'Image generation' },
    { label: 'Z Image', id: 'z-image', icon: 'Z', logoUrl: 'https://qmaealblegvcwodlmeht.supabase.co/storage/v1/object/public/website%20content/LOGOS/6.png', note: 'Creative image model' },
    { label: 'GPT Image 1.5', id: 'gpt-image-1-5', icon: 'G1', logoUrl: 'https://qmaealblegvcwodlmeht.supabase.co/storage/v1/object/public/website%20content/LOGOS/2.png', note: 'OpenAI image model' },
    { label: 'Nano Banana', id: 'nano-banana', icon: 'NB', logoUrl: 'https://qmaealblegvcwodlmeht.supabase.co/storage/v1/object/public/website%20content/LOGOS/13.png', note: 'Image editing' },
  ];

  const IMAGE_MENU_TOOLS = [
    { label: 'Image Upscale', href: '/upscale.html', icon: 'UP', logoUrl: 'https://qmaealblegvcwodlmeht.supabase.co/storage/v1/object/public/website%20content/LOGOS/7.png', note: 'Increase image quality' },
    { label: 'Full angles', href: '/expand.html?mode=angles', icon: 'FA', logoUrl: 'https://qmaealblegvcwodlmeht.supabase.co/storage/v1/object/public/website%20content/LOGOS/8.png', note: 'Different angles chosen' },
    { label: 'Expand', href: '/expand.html?mode=expand', icon: 'EX', logoUrl: 'https://qmaealblegvcwodlmeht.supabase.co/storage/v1/object/public/website%20content/LOGOS/9.png', note: 'Extend image edges' },
    { label: 'Character', href: '/character.html', icon: 'CH', logoUrl: 'https://qmaealblegvcwodlmeht.supabase.co/storage/v1/object/public/website%20content/LOGOS/11.png', note: 'Character creator' },
    { label: 'Product Card', href: '/product_card.html', icon: 'PC', logoUrl: 'https://qmaealblegvcwodlmeht.supabase.co/storage/v1/object/public/website%20content/LOGOS/12.png', note: 'Product selling cards' },
  ];

  const PROMPT_BUILDER_TOOL = {
    label: 'Prompt Builder',
    href: '/prompt-builder.html',
    icon: 'PB',
    logoUrl: 'https://qmaealblegvcwodlmeht.supabase.co/storage/v1/object/public/website%20content/LOGOS/17.png',
    note: 'Cartoon prompt builder'
  };

  const VIDEO_MENU_ITEMS = [
    { label: 'Seedance 2.0', id: 'seedance-2', icon: 'S2', logoUrl: 'https://qmaealblegvcwodlmeht.supabase.co/storage/v1/object/public/website%20content/LOGOS/5.png', note: 'Cinematic video model' },
    { label: 'Kling 3.0', id: 'kling-3', icon: 'K3', logoUrl: 'https://qmaealblegvcwodlmeht.supabase.co/storage/v1/object/public/website%20content/LOGOS/14.png', note: 'Advanced video generation' },
    { label: 'Seedance 2.0 Mini', id: 'seedance-2-mini', icon: 'SM', logoUrl: 'https://qmaealblegvcwodlmeht.supabase.co/storage/v1/object/public/website%20content/LOGOS/5.png', note: 'Fast cinematic video model' },
    { label: 'Kling 3 Turbo', id: 'kling-3-turbo', icon: 'KT', logoUrl: 'https://qmaealblegvcwodlmeht.supabase.co/storage/v1/object/public/website%20content/LOGOS/14.png', note: 'Fast text or image video model' },
    { label: 'Gemini Omni', id: 'gemini-omni-video', icon: 'GO', logoUrl: 'https://qmaealblegvcwodlmeht.supabase.co/storage/v1/object/public/website%20content/LOGOS/3.png', note: 'Prompt, image, and video inputs' },
    { label: 'Video Edit', href: '/video-edit.html', icon: 'VE', logoUrl: 'https://qmaealblegvcwodlmeht.supabase.co/storage/v1/object/public/website%20content/LOGOS/22.png', note: 'Edit uploaded video' },
    { label: 'Background Change', href: '/background-change.html', icon: 'BG', logoUrl: 'https://qmaealblegvcwodlmeht.supabase.co/storage/v1/object/public/website%20content/LOGOS/23.png', note: 'Change video background' },
    { label: 'Video Relight', href: '/video-relight.html', icon: 'VR', logoUrl: 'https://qmaealblegvcwodlmeht.supabase.co/storage/v1/object/public/website%20content/LOGOS/24.png', note: 'Change video lighting' },
    { label: 'HappyHorse 1.0', id: 'happyhorse-1', icon: 'HH', logoUrl: 'https://qmaealblegvcwodlmeht.supabase.co/storage/v1/object/public/website%20content/LOGOS/15.png', note: 'Video and audio model' },
    { label: 'Veo 3.1', id: 'veo31', icon: 'V3', logoUrl: 'https://qmaealblegvcwodlmeht.supabase.co/storage/v1/object/public/website%20content/LOGOS/3.png', note: 'Google video model' },
    { label: 'Grok', id: 'grok-video', icon: 'GX', logoUrl: 'https://qmaealblegvcwodlmeht.supabase.co/storage/v1/object/public/website%20content/LOGOS/4.png', note: 'Cinematic video' },
    { label: 'Kling 2.6', id: 'kling26', icon: 'K2', logoUrl: 'https://qmaealblegvcwodlmeht.supabase.co/storage/v1/object/public/website%20content/LOGOS/14.png', note: 'Video with sound' },
    { label: 'Kling 2.5 Turbo', id: 'kling-2-5-turbo', icon: 'KT', logoUrl: 'https://qmaealblegvcwodlmeht.supabase.co/storage/v1/object/public/website%20content/LOGOS/14.png', note: 'Fast Kling video model' },
    { label: 'Wan 2.7', id: 'wan-2-7-video', icon: 'W', logoUrl: 'https://qmaealblegvcwodlmeht.supabase.co/storage/v1/object/public/website%20content/LOGOS/6.png', note: 'First and last frame control' },
    { label: 'Kling Motion Control', id: 'kling-motion-control', icon: 'KM', logoUrl: 'https://qmaealblegvcwodlmeht.supabase.co/storage/v1/object/public/website%20content/LOGOS/14.png', note: 'Motion transfer' },
    { label: 'Aleph', id: 'aleph', icon: 'A', logoUrl: 'https://qmaealblegvcwodlmeht.supabase.co/storage/v1/object/public/website%20content/LOGOS/16.png', note: 'Video transformation' },
    { label: 'Video upscale', href: '/upscale.html?mode=video', icon: 'VU', logoUrl: 'https://qmaealblegvcwodlmeht.supabase.co/storage/v1/object/public/website%20content/LOGOS/25.png', note: 'Increase video quality' },
    { label: 'Lips sync / Avatar', href: '/lipsync.html', icon: 'LS', logoUrl: 'https://qmaealblegvcwodlmeht.supabase.co/storage/v1/object/public/website%20content/LOGOS/26.png', note: 'Talking avatar video' },
    { label: 'Kid Cartoon', href: '/kid-cartoon.html', icon: 'KC', logoUrl: 'https://qmaealblegvcwodlmeht.supabase.co/storage/v1/object/public/website%20content/LOGOS/27.png', note: 'Add your kid in cartoon' },
  ];

  const AUDIO_MENU_ITEMS = [
    { label: 'Text to speech', href: '/audio.html?tool=text-to-speech', icon: 'T2', logoUrl: 'https://qmaealblegvcwodlmeht.supabase.co/storage/v1/object/public/website%20content/LOGOS/18.png', note: 'Generate voice from text' },
    { label: 'Voice isolater', href: '/audio.html?tool=voice-isolater', icon: 'VI', logoUrl: 'https://qmaealblegvcwodlmeht.supabase.co/storage/v1/object/public/website%20content/LOGOS/19.png', note: 'Separate clean vocals' },
    { label: 'Voice changer', href: '/audio.html?tool=voice-changer', icon: 'VC', logoUrl: 'https://qmaealblegvcwodlmeht.supabase.co/storage/v1/object/public/website%20content/LOGOS/28.png', note: 'Transform a voice' },
    { label: 'Song Creation', href: '/audio.html?tool=song-creation', icon: 'SC', logoUrl: 'https://qmaealblegvcwodlmeht.supabase.co/storage/v1/object/public/website%20content/LOGOS/20.png', note: 'Create music tracks' },
  ];

  const FEATURE_MENU_ITEMS = [
    { label: 'Video upscale', href: '/upscale.html?mode=video', icon: 'VU', logoUrl: 'https://qmaealblegvcwodlmeht.supabase.co/storage/v1/object/public/website%20content/LOGOS/25.png', note: 'Increase video quality' },
    { label: 'Video Edit', href: '/video-edit.html', icon: 'VE', logoUrl: 'https://qmaealblegvcwodlmeht.supabase.co/storage/v1/object/public/website%20content/LOGOS/22.png', note: 'Edit uploaded video' },
    { label: 'Background Change', href: '/background-change.html', icon: 'BG', logoUrl: 'https://qmaealblegvcwodlmeht.supabase.co/storage/v1/object/public/website%20content/LOGOS/23.png', note: 'Change video background' },
    { label: 'Video Relight', href: '/video-relight.html', icon: 'VR', logoUrl: 'https://qmaealblegvcwodlmeht.supabase.co/storage/v1/object/public/website%20content/LOGOS/24.png', note: 'Change video lighting' },
    { label: 'Lipsync Avatar', href: '/lipsync.html', icon: 'LA', logoUrl: 'https://qmaealblegvcwodlmeht.supabase.co/storage/v1/object/public/website%20content/LOGOS/26.png', note: 'Talking avatar video' },
    { label: 'Text to speech', href: '/audio.html?tool=text-to-speech', icon: 'T2', logoUrl: 'https://qmaealblegvcwodlmeht.supabase.co/storage/v1/object/public/website%20content/LOGOS/18.png', note: 'Generate voice from text' },
    { label: 'Voice isolater', href: '/audio.html?tool=voice-isolater', icon: 'VI', logoUrl: 'https://qmaealblegvcwodlmeht.supabase.co/storage/v1/object/public/website%20content/LOGOS/19.png', note: 'Separate clean vocals' },
    { label: 'Song Creation', href: '/audio.html?tool=song-creation', icon: 'SC', logoUrl: 'https://qmaealblegvcwodlmeht.supabase.co/storage/v1/object/public/website%20content/LOGOS/20.png', note: 'Create music tracks' },
    { label: 'Hook analyse', href: '/analyse.html', icon: 'HA', logoUrl: 'https://qmaealblegvcwodlmeht.supabase.co/storage/v1/object/public/website%20content/LOGOS/21.png', note: 'Analyse hooks and ideas' },
    { label: 'Kid Cartoon', href: '/kid-cartoon.html', icon: 'KC', logoUrl: 'https://qmaealblegvcwodlmeht.supabase.co/storage/v1/object/public/website%20content/LOGOS/27.png', note: 'Add your kid in cartoon' },
  ];

  function ready(fn) {
    if (document.readyState !== 'loading') fn();
    else document.addEventListener('DOMContentLoaded', fn);
  }

  function normalizeAiCoursePath(pathname) {
    const path = String(pathname || '').replace(/\/+$/, '') || '/';
    if (path === '/course_arm' || path === '/course_arm.html') return '/course_arm';
    if (path === '/course_ru' || path === '/course_ru.html') return '/course_ru';
    return '';
  }

  function rememberAiCourseOrigin(pathname) {
    const coursePath = normalizeAiCoursePath(pathname);
    if (!coursePath) return '';
    try {
      localStorage.setItem(AI_COURSE_ORIGIN_KEY, coursePath);
    } catch (_) {}
    return coursePath;
  }

  function captureAiCourseOrigin() {
    if (aiCourseOriginCaptureDone) return '';
    aiCourseOriginCaptureDone = true;
    const coursePath = normalizeAiCoursePath(location.pathname);
    if (!coursePath) return '';
    try {
      const existingPath = normalizeAiCoursePath(localStorage.getItem(AI_COURSE_PENDING_ORIGIN_KEY));
      const skippedPath = normalizeAiCoursePath(sessionStorage.getItem(AI_COURSE_SKIP_CAPTURE_KEY));
      sessionStorage.removeItem(AI_COURSE_SKIP_CAPTURE_KEY);
      if (skippedPath === coursePath) return '';
      // Only treat the course as an acquisition source when it is the entry
      // page. Clicking to it from another Hansora page remains an index visit.
      if (document.referrer) {
        const referrer = new URL(document.referrer);
        if (referrer.origin === location.origin) return existingPath;
      }
      // A newly opened external course link is a new acquisition entry and
      // must replace any unfinished/stale course source in this browser.
      localStorage.setItem(AI_COURSE_PENDING_ORIGIN_KEY, coursePath);
    } catch (_) {}
    return coursePath;
  }

  function promoteAiCourseOriginForAuthenticatedUser() {
    try {
      const pendingPath = normalizeAiCoursePath(localStorage.getItem(AI_COURSE_PENDING_ORIGIN_KEY));
      if (!pendingPath) return '';
      rememberAiCourseOrigin(pendingPath);
      localStorage.removeItem(AI_COURSE_PENDING_ORIGIN_KEY);
      return pendingPath;
    } catch (_) {
      return '';
    }
  }

  function getRememberedAiCourseOrigin() {
    try {
      return normalizeAiCoursePath(localStorage.getItem(AI_COURSE_ORIGIN_KEY));
    } catch (_) {
      return '';
    }
  }

  function getPendingAiCourseOrigin() {
    try {
      return normalizeAiCoursePath(localStorage.getItem(AI_COURSE_PENDING_ORIGIN_KEY));
    } catch (_) {
      return '';
    }
  }

  function signupSourceFromCoursePath(coursePath) {
    if (coursePath === '/course_arm') return 'course_arm';
    if (coursePath === '/course_ru') return 'course_ru';
    return 'index';
  }

  function rememberSignupAttributionStart() {
    const coursePath = getPendingAiCourseOrigin();
    const source = signupSourceFromCoursePath(coursePath);
    const visitorId = readExistingAnalyticsVisitorId() || analyticsVisitorId();
    const sessionId = readExistingAnalyticsSessionId() || (visitorId ? analyticsSessionId() : null);
    const attribution = {
      source: source,
      landingPath: coursePath || '/index.html',
      visitorId: visitorId,
      sessionId: sessionId,
      startedAt: Date.now()
    };
    try {
      localStorage.setItem(SIGNUP_ATTRIBUTION_PENDING_KEY, JSON.stringify(attribution));
    } catch (_) {}
    return attribution;
  }

  function readSignupAttributionStart() {
    try {
      const value = JSON.parse(localStorage.getItem(SIGNUP_ATTRIBUTION_PENDING_KEY) || 'null');
      if (!value || !Number.isFinite(Number(value.startedAt))) return null;
      if (Date.now() - Number(value.startedAt) > SIGNUP_ATTRIBUTION_MAX_AGE_MS) {
        localStorage.removeItem(SIGNUP_ATTRIBUTION_PENDING_KEY);
        return null;
      }
      const source = value.source === 'course_arm' || value.source === 'course_ru'
        ? value.source
        : 'index';
      return {
        source: source,
        landingPath: source === 'course_arm'
          ? '/course_arm'
          : source === 'course_ru' ? '/course_ru' : '/index.html',
        visitorId: validAnalyticsId(value.visitorId),
        sessionId: validAnalyticsId(value.sessionId),
        startedAt: Number(value.startedAt)
      };
    } catch (_) {
      return null;
    }
  }

  function isRecentlyCreatedAccount(user) {
    const createdAt = Date.parse(user && user.created_at ? user.created_at : '');
    return Number.isFinite(createdAt) && Date.now() - createdAt <= SIGNUP_ATTRIBUTION_MAX_AGE_MS;
  }

  async function countryCodeForSignupAttribution() {
    try {
      const controller = typeof AbortController === 'function' ? new AbortController() : null;
      const timer = controller ? setTimeout(function () { controller.abort(); }, 1400) : null;
      const response = await fetch('/.netlify/functions/analytics-region', {
        method: 'GET',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { 'Accept': 'application/json' },
        signal: controller ? controller.signal : undefined
      });
      if (timer) clearTimeout(timer);
      if (!response.ok) return 'UNKNOWN';
      const result = await response.json();
      const country = String(result && result.country ? result.country : '').toUpperCase();
      return /^[A-Z]{2}$/.test(country) ? country : 'UNKNOWN';
    } catch (_) {
      return 'UNKNOWN';
    }
  }

  async function recordSignupAttribution(user) {
    const attribution = readSignupAttributionStart();
    if (!attribution || !user || !user.id || !sb) return false;
    if (!isRecentlyCreatedAccount(user)) {
      try { localStorage.removeItem(SIGNUP_ATTRIBUTION_PENDING_KEY); } catch (_) {}
      return false;
    }
    const countryCode = await countryCodeForSignupAttribution();
    const { error } = await sb.rpc('record_registration_attribution', {
      p_signup_source: attribution.source,
      p_country_code: countryCode,
      p_visitor_id: attribution.visitorId,
      p_session_id: attribution.sessionId
    });
    if (error) {
      console.warn('Hansora signup attribution write failed', error);
      return false;
    }
    try { localStorage.removeItem(SIGNUP_ATTRIBUTION_PENDING_KEY); } catch (_) {}
    return true;
  }

  function isTelegramWebView() {
    const tg = window.Telegram && window.Telegram.WebApp;
    const ua = navigator.userAgent || '';
    const search = `${window.location.search || ''}${window.location.hash || ''}`;
    return !!tg || /\bTelegram\b/i.test(ua) || /tgWebApp/i.test(search);
  }

  function applyTelegramViewportFix() {
    if (!isTelegramWebView()) return;

    const root = document.documentElement;
    const body = document.body;
    const tg = window.Telegram && window.Telegram.WebApp;

    root.classList.add('hansora-telegram-webview');
    if (body) body.classList.add('hansora-telegram-webview');

    function updateViewportVars() {
      const viewportHeight = tg && Number(tg.viewportHeight) ? Number(tg.viewportHeight) : window.innerHeight;
      const stableViewportHeight = tg && Number(tg.stableViewportHeight) ? Number(tg.stableViewportHeight) : viewportHeight;
      root.style.setProperty('--hansora-tg-vh', `${Math.max(viewportHeight, stableViewportHeight)}px`);
      root.style.setProperty('--hansora-tg-safe-top', '0px');
      root.style.setProperty('--hansora-tg-safe-bottom', '0px');
    }

    try {
      if (tg) {
        tg.ready();
        if (typeof tg.expand === 'function') tg.expand();
        if (typeof tg.disableVerticalSwipes === 'function') tg.disableVerticalSwipes();
        if (typeof tg.onEvent === 'function') tg.onEvent('viewportChanged', updateViewportVars);
      }
    } catch (_) {}

    updateViewportVars();
    window.addEventListener('resize', updateViewportVars, { passive: true });
    window.addEventListener('orientationchange', updateViewportVars, { passive: true });
  }

  function ensureSupabaseClient() {
    if (window.__HANSORA_SB__) {
      sb = window.__HANSORA_SB__;
      return sb;
    }
    if (!window.supabase || !window.supabase.createClient) {
      console.error('Supabase library not loaded; cannot initialize Hansora header.');
      return null;
    }
    window.__HANSORA_SB__ = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    sb = window.__HANSORA_SB__;
    window.hansoraSupabase = sb;
    return sb;
  }

  function readCache(key, fallback = '') {
    try {
      const value = localStorage.getItem(CACHE_PREFIX + key);
      return value == null ? fallback : value;
    } catch (_) {
      return fallback;
    }
  }

  function writeCache(key, value) {
    try {
      localStorage.setItem(CACHE_PREFIX + key, String(value));
    } catch (_) {}
  }

  function clearCache() {
    try {
      ['loggedIn', 'credits', 'avatar'].forEach((key) => localStorage.removeItem(CACHE_PREFIX + key));
    } catch (_) {}
  }

  const ANALYTICS_CONSENT_KEY = 'hansora.analytics.consent.v1';
  const ANALYTICS_CONSENT_VERSION = 'analytics-v1';
  const ANALYTICS_VISITOR_ID_KEY = 'hansora.analytics.visitor_id';
  const ANALYTICS_SESSION_ID_KEY = 'hansora.analytics.session_id';
  let analyticsConsentMemory = '';
  let analyticsConsentMode = 'pending';
  let analyticsAuthCache = null;

  function readAnalyticsConsent() {
    try {
      const saved = localStorage.getItem(ANALYTICS_CONSENT_KEY) || '';
      if (saved === 'accepted' || saved === 'rejected') return saved;
    } catch (_) {}
    return analyticsConsentMemory;
  }

  function writeAnalyticsConsent(value) {
    analyticsConsentMemory = value === 'accepted' ? 'accepted' : 'rejected';
    try {
      localStorage.setItem(ANALYTICS_CONSENT_KEY, analyticsConsentMemory);
      if (analyticsConsentMemory === 'rejected') {
        localStorage.removeItem(ANALYTICS_VISITOR_ID_KEY);
      }
    } catch (_) {}
  }

  function anonymousAnalyticsAllowed() {
    const consent = readAnalyticsConsent();
    if (consent === 'rejected') return false;
    if (analyticsConsentMode === 'consent_required') return consent === 'accepted';
    if (analyticsConsentMode === 'opt_out') return true;
    return false;
  }

  function analyticsVisitorId() {
    if (!anonymousAnalyticsAllowed()) return null;
    try {
      let value = localStorage.getItem(ANALYTICS_VISITOR_ID_KEY);
      if (!value) {
        value = window.crypto && typeof window.crypto.randomUUID === 'function'
          ? window.crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
        localStorage.setItem(ANALYTICS_VISITOR_ID_KEY, value);
      }
      return value;
    } catch (_) {
      return null;
    }
  }

  function validAnalyticsId(value) {
    const normalized = typeof value === 'string' ? value.trim() : '';
    return normalized.length >= 8 && normalized.length <= 128 ? normalized : null;
  }

  function readExistingAnalyticsVisitorId() {
    try {
      return validAnalyticsId(localStorage.getItem(ANALYTICS_VISITOR_ID_KEY));
    } catch (_) {
      return null;
    }
  }

  function readExistingAnalyticsSessionId() {
    try {
      return validAnalyticsId(sessionStorage.getItem(ANALYTICS_SESSION_ID_KEY));
    } catch (_) {
      return null;
    }
  }

  function restoreExistingAnalyticsSessionId(sessionId) {
    const existingSessionId = readExistingAnalyticsSessionId();
    const preservedSessionId = validAnalyticsId(sessionId);
    if (existingSessionId || !preservedSessionId) return existingSessionId;
    try {
      sessionStorage.setItem(ANALYTICS_SESSION_ID_KEY, preservedSessionId);
      return preservedSessionId;
    } catch (_) {
      return null;
    }
  }

  function createAuthAttemptId() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') {
      return window.crypto.randomUUID();
    }
    return `${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
  }

  function beginAuthFunnelAttempt(provider, attribution) {
    const normalizedProvider = provider === 'telegram' ? 'telegram' : 'google';
    const sourceAttribution = attribution || readSignupAttributionStart() || {};
    const visitorId = validAnalyticsId(sourceAttribution.visitorId)
      || readExistingAnalyticsVisitorId();
    if (!visitorId) return null;
    const sessionId = validAnalyticsId(sourceAttribution.sessionId)
      || readExistingAnalyticsSessionId();
    const attempt = {
      attemptId: createAuthAttemptId(),
      visitorId: visitorId,
      sessionId: sessionId,
      provider: normalizedProvider,
      source: sourceAttribution.source === 'course_arm' || sourceAttribution.source === 'course_ru'
        ? sourceAttribution.source
        : 'index',
      startedAt: Date.now()
    };
    try {
      localStorage.setItem(AUTH_FUNNEL_PENDING_KEY, JSON.stringify(attempt));
    } catch (_) {}
    return attempt;
  }

  function readAuthFunnelAttempt() {
    try {
      const value = JSON.parse(localStorage.getItem(AUTH_FUNNEL_PENDING_KEY) || 'null');
      if (!value || !Number.isFinite(Number(value.startedAt))) return null;
      if (Date.now() - Number(value.startedAt) > AUTH_FUNNEL_MAX_AGE_MS) {
        localStorage.removeItem(AUTH_FUNNEL_PENDING_KEY);
        return null;
      }
      const visitorId = validAnalyticsId(value.visitorId);
      const attemptId = validAnalyticsId(value.attemptId);
      if (!visitorId || !attemptId) return null;
      return {
        attemptId: attemptId,
        visitorId: visitorId,
        sessionId: validAnalyticsId(value.sessionId),
        provider: value.provider === 'telegram' ? 'telegram' : 'google',
        source: value.source === 'course_arm' || value.source === 'course_ru'
          ? value.source
          : 'index',
        startedAt: Number(value.startedAt)
      };
    } catch (_) {
      return null;
    }
  }

  function clearAuthFunnelAttempt() {
    try {
      localStorage.removeItem(AUTH_FUNNEL_PENDING_KEY);
    } catch (_) {}
  }

  function authCallbackErrorReason() {
    try {
      const query = new URLSearchParams(AUTH_CALLBACK_SEARCH_SNAPSHOT);
      const hash = new URLSearchParams(String(AUTH_CALLBACK_HASH_SNAPSHOT).replace(/^#/, ''));
      return String(
        query.get('error_description') || query.get('error_code') || query.get('error') ||
        hash.get('error_description') || hash.get('error_code') || hash.get('error') || ''
      ).replace(/\+/g, ' ').trim().slice(0, 500);
    } catch (_) {
      return '';
    }
  }

  function authCallbackWasReceived() {
    const attempt = readAuthFunnelAttempt();
    if (!attempt) return false;
    try {
      const queryPart = String(AUTH_CALLBACK_SEARCH_SNAPSHOT).replace(/^\?/, '');
      const hashPart = String(AUTH_CALLBACK_HASH_SNAPSHOT).replace(/^#/, '');
      const params = new URLSearchParams(
        [queryPart, hashPart].filter(Boolean).join('&')
      );
      if (
        params.has('code') || params.has('access_token') || params.has('refresh_token') ||
        params.has('error') || params.has('error_code') || params.has('error_description') ||
        String(AUTH_CALLBACK_HASH_SNAPSHOT).indexOf('sb=') !== -1
      ) return true;
      const referrer = String(AUTH_CALLBACK_REFERRER_SNAPSHOT);
      return /supabase\.co|accounts\.google\.com|oauth\.telegram\.org/i.test(referrer)
        && (location.pathname === '/index.html' || location.pathname === '/');
    } catch (_) {
      return false;
    }
  }

  async function recordAuthFunnelEvent(eventName, attempt, options) {
    const activeAttempt = attempt || readAuthFunnelAttempt();
    if (!activeAttempt || !activeAttempt.visitorId || !activeAttempt.attemptId) return false;
    const details = options || {};
    const auth = readAnalyticsAuth();
    const userId = details.userId || null;
    const useAuthenticatedToken = Boolean(userId && auth && auth.accessToken && auth.userId === userId);
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = controller ? setTimeout(function () { controller.abort(); }, 1400) : null;
    try {
      const response = await fetch(
        `${SUPABASE_URL}/rest/v1/auth_funnel_events`,
        {
          method: 'POST',
          keepalive: true,
          signal: controller ? controller.signal : undefined,
          headers: {
            'Content-Type': 'application/json',
            'apikey': SUPABASE_ANON_KEY,
            'Authorization': `Bearer ${useAuthenticatedToken ? auth.accessToken : SUPABASE_ANON_KEY}`,
            'Prefer': 'return=minimal'
          },
          body: JSON.stringify({
            attempt_id: activeAttempt.attemptId,
            visitor_id: activeAttempt.visitorId,
            session_id: activeAttempt.sessionId,
            event_name: eventName,
            auth_provider: activeAttempt.provider,
            signup_source: activeAttempt.source,
            page_path: `${location.pathname || '/'}${location.search || ''}`.slice(0, 300),
            error_reason: details.errorReason
              ? String(details.errorReason).replace(/\s+/g, ' ').trim().slice(0, 500)
              : null,
            user_id: userId
          })
        }
      );
      return response.ok;
    } catch (_) {
      return false;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  async function recordAuthFunnelFailure(error, attempt, userId) {
    const detail = error && error.message ? error.message : error || 'Authentication was not completed';
    await recordAuthFunnelEvent('auth_failed', attempt, {
      userId: userId || null,
      errorReason: detail
    });
    clearAuthFunnelAttempt();
  }

  async function captureAuthCallbackArrival() {
    const attempt = readAuthFunnelAttempt();
    if (!attempt || !authCallbackWasReceived()) return false;
    restoreExistingAnalyticsSessionId(attempt.sessionId);
    await recordAuthFunnelEvent('auth_callback_received', attempt);
    const errorReason = authCallbackErrorReason();
    if (errorReason) {
      await recordAuthFunnelFailure(errorReason, attempt);
      return true;
    }
    return true;
  }

  function removeAnalyticsConsentBanner() {
    const banner = document.getElementById('hansoraAnalyticsConsent');
    const style = document.getElementById('hansoraAnalyticsConsentStyles');
    if (banner) banner.remove();
    if (style) style.remove();
  }

  function injectAnalyticsConsentBanner() {
    if (analyticsConsentMode === 'pending') return;
    if (currentUser || readCache('loggedIn') === '1') return;
    if (readAnalyticsConsent()) return;
    if (document.getElementById('hansoraAnalyticsConsent')) return;

    const style = document.createElement('style');
    style.id = 'hansoraAnalyticsConsentStyles';
    style.textContent = `
      #hansoraAnalyticsConsent {
        position: fixed;
        left: 18px;
        bottom: 18px;
        z-index: 2147483646;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 14px;
        width: min(410px, calc(100vw - 36px));
        padding: 13px 14px 13px 16px;
        border: 1px solid rgba(139,92,246,.38);
        border-radius: 16px 16px 16px 5px;
        background:
          linear-gradient(135deg,rgba(99,102,241,.16),transparent 52%),
          rgba(7,10,22,.96);
        color: #f8fafc;
        box-shadow: 0 16px 45px rgba(0,0,0,.42),0 0 28px rgba(99,102,241,.11);
        backdrop-filter: blur(18px);
        -webkit-backdrop-filter: blur(18px);
        font-family: system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
        overflow: hidden;
        animation: hansoraConsentIn .28s ease-out both;
      }
      #hansoraAnalyticsConsent::before {
        content:"";
        position:absolute;
        top:-34px;
        right:-34px;
        width:82px;
        height:82px;
        border-radius:24px;
        transform:rotate(28deg);
        background:linear-gradient(135deg,rgba(139,92,246,.78),rgba(56,189,248,.30));
        opacity:.36;
        pointer-events:none;
      }
      #hansoraAnalyticsConsent p {
        margin: 0;
        position:relative;
        z-index:1;
        font-size: 12.5px;
        line-height: 1.4;
        color: rgba(248,250,252,.78);
      }
      #hansoraAnalyticsConsent strong { color: #fff; }
      .hansora-analytics-consent-actions {
        display: flex;
        position:relative;
        z-index:1;
        flex: 0 0 auto;
        gap: 7px;
      }
      .hansora-analytics-consent-actions button {
        min-height: 34px;
        padding: 0 12px;
        border-radius: 999px;
        border: 1px solid rgba(255,255,255,.18);
        color: #fff;
        font: inherit;
        font-size: 12px;
        font-weight: 750;
        cursor: pointer;
      }
      #hansoraAnalyticsReject { background: rgba(255,255,255,.06); }
      #hansoraAnalyticsAccept {
        border-color: transparent;
        background: linear-gradient(135deg,#6366f1,#8b5cf6);
      }
      @keyframes hansoraConsentIn {
        from { opacity:0; transform:translate3d(-8px,10px,0); }
        to { opacity:1; transform:translate3d(0,0,0); }
      }
      @media (max-width: 640px) {
        #hansoraAnalyticsConsent {
          left:12px;
          bottom:12px;
          width:calc(100vw - 24px);
          gap:10px;
          padding:12px;
        }
        #hansoraAnalyticsConsent p { font-size:12px; }
        .hansora-analytics-consent-actions button { min-height:32px; padding:0 10px; }
      }
    `;
    document.head.appendChild(style);

    const banner = document.createElement('section');
    banner.id = 'hansoraAnalyticsConsent';
    banner.setAttribute('role', 'dialog');
    banner.setAttribute('aria-label', copy('analyticsAria'));
    const consentRequired = analyticsConsentMode === 'consent_required';
    banner.innerHTML = `
      <p>${consentRequired ? copy('analyticsQuestion') : copy('analyticsNotice')}</p>
      <div class="hansora-analytics-consent-actions">
        <button id="hansoraAnalyticsReject" type="button">${copy('reject')}</button>
        <button id="hansoraAnalyticsAccept" type="button">${consentRequired ? copy('acceptAnalytics') : copy('continue')}</button>
      </div>
    `;
    document.body.appendChild(banner);

    const closeBanner = function () {
      banner.remove();
      style.remove();
    };
    banner.querySelector('#hansoraAnalyticsReject').addEventListener('click', function () {
      writeAnalyticsConsent('rejected');
      closeBanner();
    });
    banner.querySelector('#hansoraAnalyticsAccept').addEventListener('click', function () {
      writeAnalyticsConsent('accepted');
      analyticsVisitorId();
      closeBanner();
    });
  }

  async function initializeRegionalAnalyticsConsent() {
    try {
      const response = await fetch('/.netlify/functions/analytics-region', {
        method: 'GET',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { 'Accept': 'application/json' }
      });
      if (!response.ok) throw new Error(`analytics_region_${response.status}`);
      const result = await response.json();
      analyticsConsentMode = result && result.consentRequired === true
        ? 'consent_required'
        : 'opt_out';
    } catch (_) {
      // Requested behavior: unknown or unavailable location uses opt-out mode.
      analyticsConsentMode = 'opt_out';
    }
    injectAnalyticsConsentBanner();
  }

  function refreshAnalyticsAuthCache() {
    analyticsAuthCache = null;
    try {
      for (let i = 0; i < localStorage.length; i += 1) {
        const key = localStorage.key(i);
        if (!/^sb-.*-auth-token$/.test(key || '')) continue;
        const value = JSON.parse(localStorage.getItem(key) || '{}');
        const session = value.currentSession || value.session || value;
        const user = session.user || value.user || {};
        if (session.access_token && user.id) {
          analyticsAuthCache = {
            accessToken: session.access_token,
            userId: user.id,
            email: user.email || null
          };
          break;
        }
      }
    } catch (_) {}
    window.__hansoraAnalyticsAuth = analyticsAuthCache;
    return analyticsAuthCache;
  }

  function readAnalyticsAuth() {
    return analyticsAuthCache || window.__hansoraAnalyticsAuth || null;
  }

  function clickDestination(element) {
    const raw = element && element.getAttribute ? element.getAttribute('href') || '' : '';
    if (!raw || raw.charAt(0) === '#') return raw.slice(0, 180) || null;
    try {
      const url = new URL(raw, location.href);
      return url.origin === location.origin
        ? `${url.pathname}${url.hash}`.slice(0, 300)
        : `${url.origin}${url.pathname}`.slice(0, 300);
    } catch (_) {
      return raw.slice(0, 300);
    }
  }

  function analyticsSessionId() {
    try {
      let value = sessionStorage.getItem(ANALYTICS_SESSION_ID_KEY);
      if (!value) {
        value = window.crypto && typeof window.crypto.randomUUID === 'function'
          ? window.crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
        sessionStorage.setItem(ANALYTICS_SESSION_ID_KEY, value);
      }
      return value;
    } catch (_) {
      return null;
    }
  }

  function bindGlobalClickTracking() {
    if (window.__hansoraGlobalClickTrackingBound) return;
    window.__hansoraGlobalClickTrackingBound = true;
    refreshAnalyticsAuthCache();
    window.addEventListener('storage', function (event) {
      if (/^sb-.*-auth-token$/.test(event.key || '')) refreshAnalyticsAuthCache();
    });

    document.addEventListener('click', function (event) {
      try {
        const target = event.target && event.target.closest
          ? event.target.closest('a,button,[role="button"]')
          : null;
        if (!target || target.disabled || target.getAttribute('aria-disabled') === 'true') return;

        const auth = readAnalyticsAuth();
        const isRegisteredUser = Boolean(auth && auth.userId && auth.accessToken);
        const visitorId = isRegisteredUser ? null : analyticsVisitorId();
        if (!isRegisteredUser && !visitorId) return;

        const label = String(
          target.getAttribute('aria-label') ||
          target.getAttribute('title') ||
          target.textContent ||
          target.id ||
          'unlabeled'
        ).replace(/\s+/g, ' ').trim().slice(0, 180);

        const tableName = isRegisteredUser ? 'click_events' : 'anonymous_click_events';
        const authorizationToken = isRegisteredUser ? auth.accessToken : SUPABASE_ANON_KEY;
        const payload = isRegisteredUser
          ? {
              user_id: auth.userId,
              email: auth.email,
              visitor_id: readExistingAnalyticsVisitorId(),
              event_name: 'click',
              element_type: String(target.tagName || '').toLowerCase() || null,
              element_id: String(target.id || '').slice(0, 180) || null,
              element_label: label || 'unlabeled',
              destination: clickDestination(target),
              page_path: `${location.pathname}${location.hash || ''}`.slice(0, 300),
              session_id: analyticsSessionId(),
              device_type: window.matchMedia && window.matchMedia('(max-width: 900px)').matches
                ? 'mobile'
                : 'desktop'
            }
          : {
              visitor_id: visitorId,
              session_id: analyticsSessionId(),
              event_name: 'click',
              element_type: String(target.tagName || '').toLowerCase() || null,
              element_id: String(target.id || '').slice(0, 180) || null,
              element_label: label || 'unlabeled',
              destination: clickDestination(target),
              page_path: `${location.pathname}${location.hash || ''}`.slice(0, 300),
              device_type: window.matchMedia && window.matchMedia('(max-width: 900px)').matches
                ? 'mobile'
                : 'desktop',
              consent_version: ANALYTICS_CONSENT_VERSION
            };

        fetch(`${SUPABASE_URL}/rest/v1/${tableName}`, {
          method: 'POST',
          keepalive: true,
          headers: {
            'Content-Type': 'application/json',
            'apikey': SUPABASE_ANON_KEY,
            'Authorization': `Bearer ${authorizationToken}`,
            'Prefer': 'return=minimal'
          },
          body: JSON.stringify(payload)
        }).catch(function () {});
      } catch (_) {}
    }, true);
  }

  function recordRegisteredClickEvent(eventName, details) {
    const eventDetails = details || {};
    let auth = readAnalyticsAuth();
    if (!auth || !auth.userId || !auth.accessToken) {
      refreshAnalyticsAuthCache();
      auth = readAnalyticsAuth();
    }
    if (!auth || !auth.userId || !auth.accessToken) return Promise.resolve(false);

    const target = eventDetails.target || null;
    const payload = {
      user_id: auth.userId,
      email: auth.email,
      visitor_id: readExistingAnalyticsVisitorId(),
      event_name: String(eventName || '').slice(0, 180),
      element_type: String(
        eventDetails.elementType || (target && target.tagName) || 'course_preview'
      ).toLowerCase().slice(0, 80),
      element_id: String(
        eventDetails.elementId || (target && target.id) || ''
      ).slice(0, 180) || null,
      element_label: String(eventDetails.label || eventName || 'course event')
        .replace(/\s+/g, ' ').trim().slice(0, 180),
      destination: eventDetails.destination || clickDestination(target),
      page_path: `${location.pathname}${location.hash || ''}`.slice(0, 300),
      session_id: analyticsSessionId(),
      device_type: window.matchMedia && window.matchMedia('(max-width: 900px)').matches
        ? 'mobile'
        : 'desktop'
    };

    return fetch(`${SUPABASE_URL}/rest/v1/click_events`, {
      method: 'POST',
      keepalive: true,
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${auth.accessToken}`,
        'Prefer': 'return=minimal'
      },
      body: JSON.stringify(payload)
    }).then(function (response) {
      return response.ok;
    }).catch(function () {
      return false;
    });
  }

  function bindCoursePreviewFunnelTracking() {
    if (window.__hansoraCoursePreviewTrackingBound) return;
    const coursePath = normalizeAiCoursePath(location.pathname);
    if (coursePath !== '/course_arm' && coursePath !== '/course_ru') return;

    const previewVideo = document.getElementById('introPopupVideo');
    const introModal = document.getElementById('introModal');
    const pricingModal = document.getElementById('creditsModal');
    if (!previewVideo || !introModal || !pricingModal) return;

    window.__hansoraCoursePreviewTrackingBound = true;
    const progressCheckpoints = new Set();
    let previewEnded = false;
    let lastProgress = 0;
    let pricingPopupFromPreview = false;
    let pricingPopupActionTaken = false;

    function progressPercent() {
      const duration = Number(previewVideo.duration);
      const currentTime = Number(previewVideo.currentTime);
      if (!Number.isFinite(duration) || duration <= 0 || !Number.isFinite(currentTime)) {
        return lastProgress;
      }
      lastProgress = Math.max(0, Math.min(100, Math.round((currentTime / duration) * 100)));
      return lastProgress;
    }

    function trackPreviewClose(method) {
      if (!introModal.classList.contains('open') || previewEnded) return;
      const percent = progressPercent();
      recordRegisteredClickEvent(`course_preview_closed_${method}`, {
        elementType: 'video',
        elementId: 'introPopupVideo',
        label: `Preview closed at ${percent}% (${method})`
      });
    }

    function trackPricingClose(method) {
      if (!pricingPopupFromPreview || !pricingModal.classList.contains('open')) return;
      pricingPopupActionTaken = true;
      recordRegisteredClickEvent(`course_preview_pricing_popup_closed_${method}`, {
        elementType: 'modal',
        elementId: 'creditsModal',
        label: `Post-preview pricing popup closed (${method})`
      });
      pricingPopupFromPreview = false;
    }

    document.addEventListener('click', function (event) {
      const target = event.target && event.target.closest ? event.target : null;
      if (!target) return;

      const lockedPreview = target.closest('.lesson-preview');
      if (lockedPreview && lockedPreview.closest('#playerWrap')) {
        previewEnded = false;
        pricingPopupFromPreview = false;
        recordRegisteredClickEvent('course_preview_play_clicked', {
          target: lockedPreview,
          elementType: 'button',
          elementId: 'playerWrap',
          label: 'Non-buyer clicked course preview Play'
        });
      }

      const closeButton = target.closest('[data-close-modal]');
      const clickedBackdrop = target.classList && target.classList.contains('modal');
      if (closeButton || clickedBackdrop) {
        trackPreviewClose(closeButton ? 'x' : 'backdrop');
        trackPricingClose(closeButton ? 'x' : 'backdrop');
      }

      const buyButton = target.closest('.buy');
      if (pricingPopupFromPreview && buyButton && buyButton.closest('#creditsModal')) {
        pricingPopupActionTaken = true;
        recordRegisteredClickEvent('course_preview_pricing_popup_buy_clicked', {
          target: buyButton,
          elementType: 'button',
          label: `Post-preview Buy clicked: ${buyButton.dataset.credits || 'unknown'} credits`
        });
        pricingPopupFromPreview = false;
      }
    }, true);

    document.addEventListener('keydown', function (event) {
      if (event.key !== 'Escape') return;
      trackPreviewClose('escape');
      trackPricingClose('escape');
    }, true);

    previewVideo.addEventListener('play', function () {
      previewEnded = false;
      recordRegisteredClickEvent('course_preview_play_started', {
        elementType: 'video',
        elementId: 'introPopupVideo',
        label: `Course preview playback started at ${progressPercent()}%`
      });
    });

    previewVideo.addEventListener('timeupdate', function () {
      const percent = progressPercent();
      [25, 50, 75].forEach(function (checkpoint) {
        if (percent < checkpoint || progressCheckpoints.has(checkpoint)) return;
        progressCheckpoints.add(checkpoint);
        recordRegisteredClickEvent(`course_preview_progress_${checkpoint}`, {
          elementType: 'video',
          elementId: 'introPopupVideo',
          label: `Course preview reached ${checkpoint}%`
        });
      });
    });

    previewVideo.addEventListener('ended', function () {
      previewEnded = true;
      lastProgress = 100;
      pricingPopupFromPreview = false;
      recordRegisteredClickEvent('course_preview_completed', {
        elementType: 'video',
        elementId: 'introPopupVideo',
        label: 'Course preview reached the end (100%)'
      });
      setTimeout(function () {
        if (!pricingModal.classList.contains('open')) return;
        pricingPopupFromPreview = true;
        pricingPopupActionTaken = false;
        recordRegisteredClickEvent('course_preview_pricing_popup_opened', {
          elementType: 'modal',
          elementId: 'creditsModal',
          label: 'Post-preview pricing popup opened after video reached 100%'
        });
      }, 0);
    });

    window.addEventListener('pagehide', function () {
      if (!pricingPopupFromPreview || !pricingModal.classList.contains('open') || pricingPopupActionTaken) return;
      pricingPopupActionTaken = true;
      recordRegisteredClickEvent('course_preview_pricing_popup_abandoned', {
        elementType: 'modal',
        elementId: 'creditsModal',
        label: 'User left the page while post-preview pricing popup was open'
      });
    });
  }

  function getAffiliateRefFromUrl() {
    try {
      const params = new URLSearchParams(window.location.search || '');
      const rawRef = params.get('ref') || params.get('affiliate') || params.get('affiliate_ref') || '';
      return normalizeAffiliateRef(rawRef);
    } catch (_) {
      return '';
    }
  }

  function normalizeAffiliateRef(value) {
    return String(value || '').trim().replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64).toUpperCase();
  }

  function writeAffiliateCookie(ref) {
    try {
      const secure = location.protocol === 'https:' ? '; Secure' : '';
      document.cookie = `${AFFILIATE_COOKIE_NAME}=${encodeURIComponent(ref)}; Max-Age=${AFFILIATE_REF_MAX_AGE}; Path=/; SameSite=Lax${secure}`;
    } catch (_) {}
  }

  function readAffiliateCookie() {
    try {
      const prefix = `${AFFILIATE_COOKIE_NAME}=`;
      const parts = String(document.cookie || '').split(';');
      for (const part of parts) {
        const value = part.trim();
        if (value.indexOf(prefix) === 0) return normalizeAffiliateRef(decodeURIComponent(value.slice(prefix.length)));
      }
    } catch (_) {}
    return '';
  }

  function clearAffiliateCookie() {
    try {
      const secure = location.protocol === 'https:' ? '; Secure' : '';
      document.cookie = `${AFFILIATE_COOKIE_NAME}=; Max-Age=0; Path=/; SameSite=Lax${secure}`;
    } catch (_) {}
  }

  function clearStoredAffiliateRef() {
    try {
      localStorage.removeItem(AFFILIATE_REF_KEY);
      localStorage.removeItem(AFFILIATE_PENDING_KEY);
    } catch (_) {}
    try {
      sessionStorage.removeItem(AFFILIATE_REF_KEY);
    } catch (_) {}
    clearAffiliateCookie();
  }

  function stripAffiliateRefFromCurrentUrl() {
    try {
      const url = new URL(location.href);
      const before = url.href;
      url.searchParams.delete('ref');
      url.searchParams.delete('affiliate');
      url.searchParams.delete('affiliate_ref');
      if (url.href !== before && history && history.replaceState) {
        history.replaceState(history.state, document.title, `${url.pathname}${url.search}${url.hash}`);
      }
    } catch (_) {}
  }

  function stripAffiliateRefFromLinks() {
    try {
      document.querySelectorAll('a[href]').forEach(function (link) {
        const raw = link.getAttribute('href') || '';
        if (!raw || raw.charAt(0) === '#') return;
        const url = new URL(raw, location.origin);
        if (url.origin !== location.origin) return;
        const before = `${url.pathname}${url.search}${url.hash}`;
        url.searchParams.delete('ref');
        url.searchParams.delete('affiliate');
        url.searchParams.delete('affiliate_ref');
        const after = `${url.pathname}${url.search}${url.hash}`;
        if (after !== before) link.setAttribute('href', after);
      });
    } catch (_) {}
  }

  function rememberAffiliateRef(ref, source) {
    const code = normalizeAffiliateRef(ref);
    if (!code) return '';

    const pending = {
      code,
      source: source || 'url',
      captured_at: new Date().toISOString(),
      landing_path: `${location.pathname || '/'}${location.search || ''}`,
      landing_url: location.href
    };

    try {
      localStorage.setItem(AFFILIATE_REF_KEY, code);
      localStorage.setItem(AFFILIATE_PENDING_KEY, JSON.stringify(pending));
    } catch (_) {}

    try {
      sessionStorage.setItem(AFFILIATE_REF_KEY, code);
    } catch (_) {}

    writeAffiliateCookie(code);
    return code;
  }

  function captureAffiliateRef() {
    const ref = getAffiliateRefFromUrl();
    if (ref) {
      rememberAffiliateRef(ref, 'url');
    }
    return ref;
  }

  function getStoredAffiliateRef() {
    const urlRef = getAffiliateRefFromUrl();
    if (urlRef) return rememberAffiliateRef(urlRef, 'url');

    try {
      const localRef = normalizeAffiliateRef(localStorage.getItem(AFFILIATE_REF_KEY));
      if (localRef) return localRef;
    } catch (_) {}

    try {
      const sessionRef = normalizeAffiliateRef(sessionStorage.getItem(AFFILIATE_REF_KEY));
      if (sessionRef) {
        rememberAffiliateRef(sessionRef, 'session');
        return sessionRef;
      }
    } catch (_) {}

    const cookieRef = readAffiliateCookie();
    if (cookieRef) {
      rememberAffiliateRef(cookieRef, 'cookie');
      return cookieRef;
    }

    return '';
  }

  function getPendingAffiliateRef(user) {
    try {
      const pending = JSON.parse(localStorage.getItem(AFFILIATE_PENDING_KEY) || '{}');
      if (!pending || !pending.code) return getStoredAffiliateRef();
      if (user && pending.user_id && pending.user_id !== user.id) return '';
      return normalizeAffiliateRef(pending.code);
    } catch (_) {
      return getStoredAffiliateRef();
    }
  }

  function markAffiliateRegistered(user, code) {
    const ref = normalizeAffiliateRef(code);
    if (!user || !user.id || !ref) return;
    try {
      localStorage.setItem(`${AFFILIATE_DONE_PREFIX}${user.id}.${ref}`, '1');
      const pending = JSON.parse(localStorage.getItem(AFFILIATE_PENDING_KEY) || '{}');
      if (!pending.user_id || pending.user_id === user.id) {
        localStorage.removeItem(AFFILIATE_PENDING_KEY);
      }
      localStorage.removeItem(AFFILIATE_REF_KEY);
    } catch (_) {}
    clearStoredAffiliateRef();
    stripAffiliateRefFromCurrentUrl();
    stripAffiliateRefFromLinks();
  }

  async function registerAffiliateReferral(user, code) {
    const ref = normalizeAffiliateRef(code || getPendingAffiliateRef(user) || getStoredAffiliateRef());
    if (!sb || !user || !user.id || !ref) return;

    try {
      if (localStorage.getItem(`${AFFILIATE_DONE_PREFIX}${user.id}.${ref}`)) return;
    } catch (_) {}

    try {
      const { data: referrer, error: accountError } = await sb
        .from('affiliate_accounts')
        .select('user_id, affiliate_code')
        .eq('affiliate_code', ref)
        .maybeSingle();

      if (accountError) throw accountError;
      if (!referrer || !referrer.user_id || referrer.user_id === user.id) return;

      const { data: existing, error: existingError } = await sb
        .from('affiliate_referrals')
        .select('id')
        .eq('referred_user_id', user.id)
        .maybeSingle();

      if (existingError) throw existingError;
      if (existing) {
        markAffiliateRegistered(user, ref);
        return;
      }

      const { error: insertError } = await sb.from('affiliate_referrals').insert({
        referrer_user_id: referrer.user_id,
        referred_user_id: user.id,
        affiliate_code: ref,
        status: 'registered'
      });

      if (insertError) throw insertError;
      markAffiliateRegistered(user, ref);
    } catch (affiliateError) {
      console.warn('Affiliate referral registration failed', affiliateError);
    }
  }

  function shouldRedirectWhenLoggedOut() {
    return false;
  }

  function redirectLoggedOutHome() {
    if (!shouldRedirectWhenLoggedOut()) return;
    const target = location.origin ? `${location.origin}${localizedHref('/index.html')}` : localizedHref('/index.html');
    if (location.href !== target) location.href = target;
  }

  function formatCredits(value) {
    const n = Number(value || 0);
    return `${Number.isInteger(n) ? n : n.toFixed(2)}⚡`;
  }

  function modelHref(id) {
    return localizedHref(`/search-models.html?model=${encodeURIComponent(id)}`);
  }

  function videoLandingHref(credits) {
    return modelHref(Number(credits || 0) < GROK_VIDEO_CREDIT_THRESHOLD ? 'grok-video' : 'kling-3');
  }

  function updateVideoLandingLink() {
    const link = document.querySelector('[data-hansora-video-landing]');
    if (link) link.setAttribute('href', siteHref(videoLandingHref(currentCredits)));
  }

  function withAffiliateRef(href) {
    if (currentUser && currentUser.id) return href;
    const ref = getStoredAffiliateRef();
    if (!ref || !href || href.charAt(0) === '#') return href;

    try {
      const url = new URL(href, location.origin);
      if (url.origin !== location.origin) return href;
      if (!url.searchParams.get('ref')) url.searchParams.set('ref', ref);
      return `${url.pathname}${url.search}${url.hash}`;
    } catch (_) {
      return href;
    }
  }

  function preserveAffiliateRefOnLink(link) {
    if (!link || currentUser && currentUser.id) return;
    const raw = link.getAttribute('href') || '';
    if (!raw || raw.charAt(0) === '#' || /^(?:mailto:|tel:|javascript:|data:)/i.test(raw)) return;

    const ref = getStoredAffiliateRef();
    if (!ref) return;

    try {
      const url = new URL(raw, location.origin);
      if (url.origin !== location.origin) return;
      if (!url.searchParams.get('ref')) url.searchParams.set('ref', ref);
      link.setAttribute('href', `${url.pathname}${url.search}${url.hash}`);
    } catch (_) {}
  }

  function preserveAffiliateRefAcrossPageLinks() {
    if (currentUser && currentUser.id) return;

    document.querySelectorAll('a[href]').forEach(preserveAffiliateRefOnLink);

    document.addEventListener('click', function (event) {
      const link = event.target && event.target.closest ? event.target.closest('a[href]') : null;
      if (link) preserveAffiliateRefOnLink(link);
    }, true);

    if (window.MutationObserver && document.body) {
      const observer = new MutationObserver(function (records) {
        if (currentUser && currentUser.id) {
          observer.disconnect();
          return;
        }
        records.forEach(function (record) {
          record.addedNodes.forEach(function (node) {
            if (!node || node.nodeType !== 1) return;
            if (node.matches && node.matches('a[href]')) preserveAffiliateRefOnLink(node);
            if (node.querySelectorAll) node.querySelectorAll('a[href]').forEach(preserveAffiliateRefOnLink);
          });
        });
      });
      observer.observe(document.body, { childList: true, subtree: true });
    }
  }

  function menuIconClass(index) {
    return index % 4 === 0 ? 'blue' : index % 4 === 1 ? 'violet' : index % 4 === 2 ? 'lime' : 'pink';
  }

  function itemHref(item) {
    return siteHref(item.href || modelHref(item.id));
  }

  function itemData(item) {
    return item.id && !item.href ? ` data-hansora-model="${item.id}"` : '';
  }

  function renderMegaIcon(item, index) {
    if (item.logoUrl) {
      return `<span class="hansora-mega-icon has-image"><img src="${item.logoUrl}" alt="" loading="lazy" decoding="async"></span>`;
    }
    return `<span class="hansora-mega-icon ${menuIconClass(index)}">${item.icon}</span>`;
  }

  function renderMegaItems(items, offset) {
    return items.map((item, index) => `
      <a class="hansora-mega-item" href="${itemHref(item)}"${itemData(item)}>
        ${renderMegaIcon(item, index + (offset || 0))}
        <span class="hansora-mega-copy">
          <strong>${item.label}</strong>
          <em>${translatedNote(item.note)}</em>
        </span>
      </a>`).join('');
  }

  function renderMegaMenu(config) {
    const sections = config.sections.map((section, sectionIndex) => `
      <section>
        <div class="hansora-mega-eyebrow">${section.title}</div>
        <div class="hansora-mega-grid">${renderMegaItems(section.items, sectionIndex * 2)}</div>
      </section>`).join('');
    return `
      <div class="hansora-mega-menu ${config.className || ''}" role="menu" aria-label="${config.label}">
        ${sections}
      </div>`;
  }

  function renderNavMenu(label, href, config) {
    const triggerData = config && config.videoLanding ? ' data-hansora-video-landing="1"' : '';
    return `
      <span class="hansora-nav-item">
        <a class="hansora-nav-trigger" href="${siteHref(href)}"${triggerData}>${label}</a>
        ${renderMegaMenu(config)}
      </span>`;
  }

  function injectHeaderStyles() {
    if (document.getElementById('hansoraHeaderMegaStyles')) return;
    const style = document.createElement('style');
    style.id = 'hansoraHeaderMegaStyles';
    style.textContent = `
      .nav-links .hansora-nav-item{ position:relative; display:inline-flex; align-items:center; }
      .site-header .shell.nav{ position:relative; }
      .site-header .nav-links{ position:absolute; left:50%; transform:translateX(-50%); }
      .site-header .user-menu .hansora-ai-course-button{ width:100%; text-align:left; }
      .hansora-auth-form .hansora-oauth-stack{ display:grid; gap:10px; }
      .hansora-auth-form .hansora-telegram-btn{
        position:relative;
        min-height:48px;
        overflow:hidden;
        border-color:rgba(94,207,255,.48);
        background:linear-gradient(135deg,#239ed9,#2aabee 58%,#66c8f5);
        color:#fff;
        box-shadow:0 14px 34px rgba(34,158,217,.25),inset 0 1px 0 rgba(255,255,255,.24);
      }
      .hansora-auth-form .hansora-telegram-btn::before{
        content:"";
        position:absolute;
        inset:0;
        background:linear-gradient(110deg,transparent 25%,rgba(255,255,255,.17) 48%,transparent 70%);
        transform:translateX(-120%);
        transition:transform .45s ease;
      }
      .hansora-auth-form .hansora-telegram-btn:hover::before{ transform:translateX(120%); }
      .hansora-auth-form .hansora-telegram-btn:hover{
        border-color:rgba(255,255,255,.42);
        background:linear-gradient(135deg,#1e96cf,#2aabee 58%,#7bd3f8);
      }
      .hansora-auth-form .hansora-telegram-btn svg{
        position:relative;
        z-index:1;
        width:22px;
        height:22px;
        flex:0 0 22px;
        filter:drop-shadow(0 3px 8px rgba(0,72,115,.25));
      }
      .hansora-auth-form .hansora-telegram-btn span{ position:relative; z-index:1; }
      .hansora-auth-form .hansora-telegram-btn[disabled]{ opacity:.68; cursor:wait; transform:none; }
      .hansora-course-modal{
        position:fixed;
        inset:0;
        z-index:2147483600;
        display:grid;
        place-items:center;
        padding:20px;
        background:rgba(3,5,14,.72);
        backdrop-filter:blur(12px);
        -webkit-backdrop-filter:blur(12px);
        opacity:0;
        visibility:hidden;
        transition:opacity .2s ease,visibility .2s ease;
      }
      .hansora-course-modal.is-open{ opacity:1; visibility:visible; }
      .hansora-course-dialog{
        position:relative;
        width:min(560px,100%);
        padding:32px;
        overflow:hidden;
        border:1px solid rgba(255,255,255,.14);
        border-radius:28px;
        background:
          radial-gradient(circle at 10% 0%,rgba(99,102,241,.25),transparent 42%),
          radial-gradient(circle at 95% 100%,rgba(56,189,248,.16),transparent 42%),
          #0a0d19;
        box-shadow:0 30px 100px rgba(0,0,0,.58),0 0 60px rgba(99,102,241,.13);
        color:#fff;
        transform:translateY(12px) scale(.98);
        transition:transform .22s ease;
        font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
      }
      .hansora-course-modal.is-open .hansora-course-dialog{ transform:translateY(0) scale(1); }
      .hansora-course-close{
        position:absolute;
        top:16px;
        right:16px;
        width:38px;
        height:38px;
        display:grid;
        place-items:center;
        padding:0;
        border:1px solid rgba(255,255,255,.14);
        border-radius:50%;
        background:rgba(255,255,255,.06);
        color:#fff;
        font-size:18px;
        cursor:pointer;
      }
      .hansora-course-close:hover{ background:rgba(255,255,255,.12); transform:rotate(4deg); }
      .hansora-course-eyebrow{
        margin:0 0 9px;
        color:#a5b4fc;
        font-size:12px;
        font-weight:800;
        letter-spacing:.14em;
        text-transform:uppercase;
      }
      .hansora-course-dialog h2{ margin:0; padding-right:38px; font-size:clamp(25px,4vw,34px); line-height:1.12; }
      .hansora-course-intro{ margin:10px 0 23px; color:rgba(255,255,255,.65); font-size:14px; line-height:1.55; }
      .hansora-course-options{ display:grid; gap:12px; }
      .hansora-course-option{
        display:grid;
        grid-template-columns:54px minmax(0,1fr) 28px;
        align-items:center;
        gap:15px;
        min-height:82px;
        padding:13px 16px;
        border:1px solid rgba(255,255,255,.11);
        border-radius:18px;
        background:rgba(255,255,255,.045);
        color:#fff;
        text-decoration:none;
        transition:transform .18s ease,border-color .18s ease,background .18s ease;
      }
      .hansora-course-option:hover{
        transform:translateY(-2px);
        border-color:rgba(129,140,248,.55);
        background:rgba(99,102,241,.12);
      }
      .hansora-course-flag{
        display:grid;
        place-items:center;
        width:54px;
        height:54px;
        border-radius:16px;
        background:rgba(255,255,255,.08);
        font-size:30px;
        box-shadow:inset 0 0 0 1px rgba(255,255,255,.07);
      }
      .hansora-course-copy strong{ display:block; margin-bottom:4px; font-size:17px; }
      .hansora-course-copy span{ display:block; color:rgba(255,255,255,.57); font-size:13px; line-height:1.35; }
      .hansora-course-arrow{ color:#a5b4fc; font-size:24px; transition:transform .18s ease; }
      .hansora-course-option:hover .hansora-course-arrow{ transform:translateX(3px); }
      .hansora-language-button{
        display:flex;
        align-items:center;
        justify-content:space-between;
        gap:18px;
      }
      .hansora-language-button .hansora-language-value{
        color:rgba(255,255,255,.58);
        font-size:.86em;
        font-weight:700;
      }
      .hansora-language-option{
        width:100%;
        font:inherit;
        text-align:left;
        cursor:pointer;
      }
      .hansora-language-option.is-current{
        border-color:rgba(129,140,248,.62);
        background:linear-gradient(135deg,rgba(99,102,241,.18),rgba(56,189,248,.09));
        box-shadow:inset 0 0 0 1px rgba(165,180,252,.08);
      }
      .hansora-language-current{
        display:inline-flex!important;
        width:max-content;
        margin-top:6px;
        padding:3px 8px;
        border:1px solid rgba(165,180,252,.26);
        border-radius:999px;
        background:rgba(99,102,241,.15);
        color:#c7d2fe!important;
        font-size:10px!important;
        font-weight:800;
        letter-spacing:.06em;
        text-transform:uppercase;
      }
      @media (max-width:560px){
        .hansora-course-modal{ padding:12px; }
        .hansora-course-dialog{ padding:26px 18px 20px; border-radius:23px; }
        .hansora-course-option{ grid-template-columns:48px minmax(0,1fr) 22px; gap:12px; padding:12px; }
        .hansora-course-flag{ width:48px; height:48px; border-radius:14px; font-size:27px; }
      }
      .hansora-brand-mobile{ display:none; }
      .nav-links .hansora-nav-trigger{ display:inline-flex; align-items:center; gap:8px; text-decoration:none; color:inherit; }
      .nav-links .hansora-nav-trigger::after{ content:""; width:6px; height:6px; border-right:2px solid currentColor; border-bottom:2px solid currentColor; transform:rotate(45deg); opacity:.55; margin-top:-3px; transition:transform .18s ease, opacity .18s ease; }
      .nav-links .hansora-nav-item:hover .hansora-nav-trigger::after,
      .nav-links .hansora-nav-item:focus-within .hansora-nav-trigger::after{ transform:rotate(225deg); margin-top:3px; opacity:.9; }
      .hansora-mega-menu{
        position:absolute;
        top:calc(100% + 18px);
        left:50%;
        width:min(940px,calc(100vw - 32px));
        transform:translateX(-50%) translateY(8px);
        display:grid;
        grid-template-columns:minmax(0,1.35fr) minmax(0,1fr);
        gap:18px;
        padding:18px;
        border:1px solid rgba(255,255,255,.10);
        border-radius:24px;
        background:linear-gradient(145deg,rgba(22,24,31,.98),rgba(10,12,18,.98));
        box-shadow:0 26px 80px rgba(0,0,0,.46), inset 0 1px 0 rgba(255,255,255,.08);
        backdrop-filter:blur(22px);
        opacity:0;
        visibility:hidden;
        pointer-events:none;
        transition:opacity .18s ease, transform .18s ease, visibility .18s ease;
        z-index:1000;
      }
      .hansora-mega-wide{
        width:min(700px,calc(100vw - 32px));
        grid-template-columns:1fr;
      }
      .hansora-mega-features{
        width:min(1120px,calc(100vw - 32px));
      }
      .hansora-mega-features .hansora-mega-grid{
        grid-template-columns:repeat(4,minmax(0,1fr));
      }
      .hansora-mega-video{
        width:min(940px,calc(100vw - 32px));
      }
      .hansora-mega-video .hansora-mega-grid{
        grid-template-columns:repeat(3,minmax(0,1fr));
      }
      .hansora-mega-image{
        left:calc(50% + 92px);
        width:min(940px,calc(100vw - 32px));
        max-height:calc(100dvh - 112px);
        overflow-y:auto;
      }
      .hansora-mega-image .hansora-mega-grid{
        grid-template-columns:repeat(3,minmax(0,1fr));
      }
      .nav-links .hansora-nav-item:has(> .hansora-mega-image)::before{
        content:"";
        position:absolute;
        top:100%;
        left:0;
        right:0;
        height:22px;
      }
      .hansora-mega-compact{
        width:min(560px,calc(100vw - 32px));
        grid-template-columns:1fr;
      }
      .hansora-mega-menu::before{ content:""; position:absolute; left:0; right:0; top:-22px; height:22px; }
      .nav-links .hansora-nav-item:hover .hansora-mega-menu,
      .nav-links .hansora-nav-item:focus-within .hansora-mega-menu{
        opacity:1;
        visibility:visible;
        pointer-events:auto;
        transform:translateX(-50%) translateY(0);
      }
      .hansora-mega-eyebrow{
        margin:0 0 10px;
        color:rgba(255,255,255,.48);
        font-size:11px;
        font-weight:850;
        letter-spacing:.12em;
        text-transform:uppercase;
      }
      .hansora-mega-grid{ display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:10px; }
      .hansora-mega-item{
        display:flex;
        align-items:center;
        gap:12px;
        height:70px;
        min-width:0;
        padding:10px;
        border:1px solid rgba(255,255,255,.08);
        border-radius:16px;
        background:rgba(255,255,255,.035);
        color:#fff;
        text-decoration:none;
        transition:transform .16s ease, border-color .16s ease, background .16s ease;
      }
      .hansora-mega-item:hover,
      .hansora-mega-item:focus-visible{
        transform:translateY(-1px);
        border-color:rgba(125,211,252,.42);
        background:rgba(125,211,252,.08);
        outline:none;
      }
      .hansora-mega-icon{
        width:44px;
        height:44px;
        flex:0 0 44px;
        display:grid;
        place-items:center;
        border-radius:13px;
        color:#071018;
        font-size:13px;
        font-weight:950;
        box-shadow:inset 0 1px 0 rgba(255,255,255,.65), 0 12px 26px rgba(0,0,0,.22);
      }
      .hansora-mega-icon.blue{ background:linear-gradient(135deg,#dbeafe,#7dd3fc); }
      .hansora-mega-icon.violet{ background:linear-gradient(135deg,#fde68a,#a78bfa,#f472b6); }
      .hansora-mega-icon.lime{ background:linear-gradient(135deg,#ecfccb,#bef264); }
      .hansora-mega-icon.pink{ background:linear-gradient(135deg,#67e8f9,#c084fc,#f472b6); }
      .hansora-mega-icon.has-image{
        overflow:hidden;
        background:#0d1017;
        box-shadow:inset 0 0 0 1px rgba(255,255,255,.08), 0 12px 26px rgba(0,0,0,.22);
      }
      .hansora-mega-icon.has-image img{
        display:block;
        width:100%;
        height:100%;
        object-fit:cover;
      }
      .hansora-mega-copy{ display:block; min-width:0; overflow:hidden; }
      .hansora-mega-item strong{
        display:-webkit-box;
        color:rgba(255,255,255,.94);
        font-size:13px;
        line-height:1.12;
        font-weight:900;
        overflow:hidden;
        text-overflow:ellipsis;
        -webkit-line-clamp:2;
        -webkit-box-orient:vertical;
      }
      .hansora-mega-item em{
        display:-webkit-box;
        margin-top:4px;
        color:rgba(255,255,255,.48);
        font-size:11px;
        font-style:normal;
        line-height:1.18;
        overflow:hidden;
        text-overflow:ellipsis;
        -webkit-line-clamp:2;
        -webkit-box-orient:vertical;
      }
      @media (max-width:900px){
        .site-header .nav-links{ position:static; transform:none; }
        .hansora-mega-menu{ left:0; transform:translateX(-16px) translateY(8px); grid-template-columns:1fr; width:min(92vw,520px); max-height:72vh; overflow:auto; }
        .hansora-mega-image{ left:0; }
        .hansora-mega-image .hansora-mega-grid{ grid-template-columns:1fr; }
        .nav-links .hansora-nav-item:hover .hansora-mega-menu,
        .nav-links .hansora-nav-item:focus-within .hansora-mega-menu{ transform:translateX(-16px) translateY(0); }
      }
      .hansora-mobile-pricing{
        position:relative;
        min-width:76px;
        height:42px;
        display:inline-flex;
        align-items:flex-start;
        justify-content:center;
        padding:8px 12px 0;
        border:1px solid rgba(255,255,255,.10);
        border-radius:14px;
        background:linear-gradient(145deg,#181a21,#0f1117);
        box-shadow:inset 0 1px 0 rgba(255,255,255,.07),0 7px 16px rgba(0,0,0,.24);
        color:#fff;
        font-size:13px;
        font-weight:900;
        line-height:1;
        letter-spacing:.01em;
        text-decoration:none;
        white-space:nowrap;
      }
      .hansora-mobile-pricing > span{
        transform:translateY(2px);
      }
      .hansora-mobile-pricing-badge{
        position:absolute;
        left:50%;
        bottom:-8px;
        transform:translateX(-50%);
        min-width:64px;
        padding:3px 7px;
        border:1px solid rgba(255,255,255,.16);
        border-radius:999px;
        background:#ef233c;
        box-shadow:0 5px 13px rgba(239,35,60,.38);
        color:#fff;
        font-size:9px;
        font-weight:950;
        line-height:1;
        text-align:center;
        letter-spacing:.04em;
      }
      @media (max-width:720px){
        .site-header .shell.nav{
          min-height:58px !important;
          padding-left:7px !important;
          padding-right:7px !important;
          gap:5px !important;
        }
        .site-header .brand{
          min-width:0 !important;
          gap:5px !important;
          margin-right:auto !important;
        }
        .site-header .brand img{
          width:32px !important;
          height:32px !important;
          flex:0 0 32px !important;
        }
        .site-header .brand span{
          font-size:16px !important;
          letter-spacing:.01em !important;
          white-space:nowrap !important;
        }
        .hansora-brand-full{ display:none; }
        .hansora-brand-mobile{ display:inline; }
        .site-header .nav-actions{
          gap:5px !important;
          margin-left:0 !important;
        }
        .site-header .credits-pill{
          min-height:32px !important;
          padding:0 7px !important;
          border-radius:12px !important;
          font-size:12px !important;
          white-space:nowrap !important;
        }
        .site-header .avatar-button{
          width:32px !important;
          height:32px !important;
          min-width:32px !important;
          flex:0 0 32px !important;
        }
        .site-header .avatar-button img{
          width:100% !important;
          height:100% !important;
        }
        .hansora-mobile-pricing{
          position:relative;
          min-width:62px;
          height:34px;
          display:inline-flex;
          align-items:flex-start;
          justify-content:center;
          padding:6px 8px 0;
          font-size:11px;
        }
        .hansora-mobile-pricing-badge{
          min-width:53px;
          padding:3px 6px;
          font-size:8px;
        }
      }
      @media (max-width:390px){
        .site-header .brand img{ width:29px !important; height:29px !important; flex-basis:29px !important; }
        .site-header .brand span{ font-size:14px !important; }
        .site-header .credits-pill{ padding:0 6px !important; font-size:11px !important; }
        .hansora-mobile-pricing{ min-width:58px; padding-left:6px; padding-right:6px; }
      }
      html.hansora-telegram-webview,
      html.hansora-telegram-webview body{
        min-height:var(--hansora-tg-vh,100dvh);
        height:auto;
        overflow-x:hidden;
      }
      html.hansora-telegram-webview body{
        margin-top:0 !important;
        padding-top:0 !important;
      }
      html.hansora-pricing-popup,
      html.hansora-pricing-popup body{
        min-height:100%;
        overflow:auto;
        background:#070912;
      }
      html.hansora-pricing-popup body{
        padding-top:0 !important;
      }
      html.hansora-pricing-popup #sharedHeader,
      html.hansora-pricing-popup .site-header,
      html.hansora-pricing-popup .hs-bottom-nav,
      html.hansora-pricing-popup .bottom-nav,
      html.hansora-pricing-popup footer{
        display:none !important;
      }
      html.hansora-telegram-webview #sharedHeader{
        margin-top:0 !important;
        padding-top:0 !important;
        transform:none !important;
      }
      html.hansora-telegram-webview .site-header{
        top:0 !important;
        margin-top:0 !important;
        padding-top:0 !important;
        transform:none !important;
      }
      html.hansora-telegram-webview main{
        min-height:auto;
      }
      @media (max-width:900px){
        html.hansora-telegram-webview .site-header .shell.nav{
          min-height:64px;
        }
      }
      @media (max-width:560px){ .hansora-mega-grid{ grid-template-columns:1fr; } }
      .hansora-offer-modal{
        position:fixed;
        inset:0;
        z-index:2147483000;
        display:flex;
        align-items:center;
        justify-content:center;
        padding:18px;
        background:rgba(3,6,18,.72);
        backdrop-filter:blur(12px);
        -webkit-backdrop-filter:blur(12px);
        opacity:0;
        pointer-events:none;
        transition:opacity .22s ease;
      }
      .hansora-offer-modal.is-open{
        opacity:1;
        pointer-events:auto;
      }
      .hansora-offer-panel{
        position:relative;
        width:min(1120px,100%);
        height:min(760px,calc(100dvh - 36px));
        border:1px solid rgba(255,255,255,.16);
        border-radius:28px;
        overflow:hidden;
        background:#070912;
        box-shadow:0 34px 110px rgba(0,0,0,.58);
        transform:translateY(24px) scale(.98);
        transition:transform .24s ease;
      }
      .hansora-offer-modal.is-open .hansora-offer-panel{
        transform:translateY(0) scale(1);
      }
      .hansora-offer-modal.is-closing{
        opacity:0;
      }
      .hansora-offer-modal.is-closing .hansora-offer-panel{
        transform:translateY(110vh) scale(.98);
      }
      .hansora-offer-frame{
        width:100%;
        height:100%;
        border:0;
        display:block;
        background:#070912;
      }
      .hansora-offer-close{
        position:absolute;
        top:14px;
        right:14px;
        z-index:3;
        width:42px;
        height:42px;
        border-radius:999px;
        border:1px solid rgba(255,255,255,.30);
        background:rgba(7,9,18,.88);
        color:#fff;
        font-size:27px;
        line-height:0;
        font-weight:800;
        box-shadow:0 10px 28px rgba(0,0,0,.42), inset 0 1px 0 rgba(255,255,255,.12);
        backdrop-filter:blur(12px);
        -webkit-backdrop-filter:blur(12px);
        outline:none;
        display:flex;
        align-items:center;
        justify-content:center;
        padding:0;
        text-align:center;
        cursor:pointer;
        transition:background .16s ease, border-color .16s ease, transform .16s ease, opacity .16s ease;
      }
      .hansora-offer-close:hover{
        background:rgba(124,58,237,.92);
        border-color:rgba(255,255,255,.58);
        color:#fff;
        opacity:1;
        transform:scale(1.06);
      }
      .hansora-offer-close:focus,
      .hansora-offer-close:focus-visible{ outline:none; box-shadow:none; }
      @media (max-width:720px){
        .hansora-offer-modal{ padding:10px; }
        .hansora-offer-panel{
          height:calc(100dvh - 20px);
          border-radius:22px;
        }
        .hansora-offer-close{
          top:10px;
          right:10px;
          width:40px;
          height:40px;
        }
      }
    `;
    document.head.appendChild(style);
  }

  function injectHeader() {
    const mount = document.getElementById('sharedHeader');
    if (!mount || mount.dataset.hansoraHeaderMounted === '1') return;
    mount.dataset.hansoraHeaderMounted = '1';
    document.documentElement.lang = LANGUAGE_META[CURRENT_LANGUAGE].htmlLang;
    const cachedLoggedIn = readCache('loggedIn') === '1';
    const cachedCredits = readCache('credits', '0');
    const cachedAvatar = readCache('avatar', 'https://ui-avatars.com/api/?name=H&background=6366f1&color=fff');
    const currentLanguage = LANGUAGE_META[CURRENT_LANGUAGE];
    const languageOptions = ['en', 'ru', 'hy'].map(function (languageCode) {
      const language = LANGUAGE_META[languageCode];
      const descriptions = {
        en: 'Website in English',
        hy: 'Կայքը հայերեն',
        ru: 'Сайт на русском'
      };
      const isCurrent = languageCode === CURRENT_LANGUAGE;
      return `
        <button class="hansora-course-option hansora-language-option${isCurrent ? ' is-current' : ''}" type="button" data-language-code="${languageCode}">
          <span class="hansora-course-flag" aria-hidden="true">${language.flag}</span>
          <span class="hansora-course-copy"><strong>${language.name}</strong><span>${descriptions[languageCode]}</span>${isCurrent ? `<span class="hansora-language-current">${copy('current')}</span>` : ''}</span>
          <span class="hansora-course-arrow" aria-hidden="true">›</span>
        </button>`;
    }).join('');
    mount.innerHTML = `
      <header class="site-header" id="siteHeader">
        <div class="shell nav">
          <a class="brand" href="${siteHref('/')}" aria-label="${copy('home')}">
            <img src="${LOGO_URL}" alt="">
            <span><span class="hansora-brand-full">HANSORA AI</span><span class="hansora-brand-mobile">HANSORA</span></span>
          </a>
          <nav class="nav-links" aria-label="${copy('primaryNav')}">
            ${renderNavMenu(copy('image'), '/search-models.html', {
              label: copy('imageMenu'),
              className: 'hansora-mega-wide hansora-mega-image',
              sections: [
                { title: copy('imageSection'), items: [...IMAGE_MENU_MODELS, ...IMAGE_MENU_TOOLS] },
              ]
            })}
            ${renderNavMenu(copy('video'), videoLandingHref(cachedCredits), {
              label: copy('videoMenu'),
              className: 'hansora-mega-wide hansora-mega-video',
              videoLanding: true,
              sections: [
                { title: copy('videoMenu'), items: VIDEO_MENU_ITEMS },
              ]
            })}
            ${renderNavMenu(copy('features'), '/models.html', {
              label: copy('featureMenu'),
              className: 'hansora-mega-wide hansora-mega-features',
              sections: [
                { title: copy('imageTools'), items: [...IMAGE_MENU_TOOLS, PROMPT_BUILDER_TOOL] },
                { title: copy('videoAudioTools'), items: FEATURE_MENU_ITEMS },
              ]
            })}
            ${renderNavMenu(copy('audio'), '/audio.html', {
              label: copy('audioTools'),
              className: 'hansora-mega-compact',
              sections: [
                { title: copy('audioTools'), items: AUDIO_MENU_ITEMS },
              ]
            })}
          </nav>
          <div class="nav-actions">
            <a class="hansora-mobile-pricing" href="${siteHref('/pricing.html')}" aria-label="${copy('pricingAria')}">
              <span>${copy('pricing')}</span>
              <strong class="hansora-mobile-pricing-badge">${copy('discount')}</strong>
            </a>
            <button class="btn btn-ghost" type="button" id="btnLoginSignup" style="display:${cachedLoggedIn ? 'none' : 'inline-flex'}">${copy('login')}</button>
            <span class="credits-pill" id="navCredits" style="display:${cachedLoggedIn ? 'inline-flex' : 'none'}">${formatCredits(cachedCredits)}</span>
            <button class="avatar-button" type="button" id="navAvatar" aria-label="${copy('openAccount')}" style="display:${cachedLoggedIn ? 'inline-flex' : 'none'}">
              <img id="navAvatarImg" alt="" src="${cachedAvatar}">
            </button>
            <a class="btn btn-primary" href="${siteHref('/search-models.html')}" id="btnGetStarted">${copy('startCreating')}</a>
          </div>
        </div>
        <div class="user-menu" id="navMenu">
          <a href="${siteHref('/profile.html')}">${copy('profile')}</a>
          <a href="${siteHref('/usage.html')}">${copy('history')}</a>
          <a href="${siteHref('/pricing.html')}">${copy('credits')}</a>
          <button class="hansora-ai-course-button" type="button" id="btnAiCourse">${copy('aiCourse')}</button>
          <button class="hansora-ai-course-button hansora-language-button" type="button" id="btnLanguage"><strong>${copy('language')}</strong><span class="hansora-language-value">${currentLanguage.flag} ${currentLanguage.name} ›</span></button>
          <button type="button" id="btnLogout">${copy('logout')}</button>
        </div>
      </header>
      <div class="hansora-course-modal" id="aiCourseModal" aria-hidden="true">
        <section class="hansora-course-dialog" role="dialog" aria-modal="true" aria-labelledby="aiCourseTitle">
          <button class="hansora-course-close" id="aiCourseClose" type="button" aria-label="${copy('closeCourse')}">✕</button>
          <p class="hansora-course-eyebrow">${copy('courseEyebrow')}</p>
          <h2 id="aiCourseTitle">${copy('courseTitle')}</h2>
          <p class="hansora-course-intro">${copy('courseIntro')}</p>
          <div class="hansora-course-options">
            <a class="hansora-course-option" href="/course_arm" data-ai-course-path="/course_arm">
              <span class="hansora-course-flag" aria-hidden="true">🇦🇲</span>
              <span class="hansora-course-copy"><strong>Հայերեն լեզվով դասեր</strong><span>AI դասընթաց՝ հայերեն բացատրություններով</span></span>
              <span class="hansora-course-arrow" aria-hidden="true">›</span>
            </a>
            <a class="hansora-course-option" href="/course_ru" data-ai-course-path="/course_ru">
              <span class="hansora-course-flag" aria-hidden="true">🇷🇺</span>
              <span class="hansora-course-copy"><strong>Курс на русском языке</strong><span>Уроки по AI с объяснениями на русском</span></span>
              <span class="hansora-course-arrow" aria-hidden="true">›</span>
            </a>
          </div>
        </section>
      </div>
      <div class="hansora-course-modal hansora-language-modal" id="languageModal" aria-hidden="true">
        <section class="hansora-course-dialog" role="dialog" aria-modal="true" aria-labelledby="languageModalTitle">
          <button class="hansora-course-close" id="languageClose" type="button" aria-label="${copy('closeLanguage')}">✕</button>
          <p class="hansora-course-eyebrow">${copy('languageEyebrow')}</p>
          <h2 id="languageModalTitle">${copy('languageTitle')}</h2>
          <p class="hansora-course-intro">${copy('languageIntro')}</p>
          <div class="hansora-course-options">${languageOptions}</div>
        </section>
      </div>`;

    // Center the chooser against the viewport, not a transformed header parent.
    const courseModal = mount.querySelector('#aiCourseModal');
    if (courseModal && document.body) document.body.appendChild(courseModal);
    const languageModal = mount.querySelector('#languageModal');
    if (languageModal && document.body) document.body.appendChild(languageModal);
  }

  function injectAuthModal() {
    if (document.getElementById('authModal')) return;
    document.body.insertAdjacentHTML('beforeend', `
      <div class="hansora-auth-modal" id="authModal" aria-hidden="true">
        <div class="hansora-auth-card" id="authCard" role="dialog" aria-modal="true" aria-labelledby="authTitle">
          <div class="hansora-auth-head">
            <h3 id="authTitle">${copy('logIn')}</h3>
            <button class="btn hansora-auth-close" id="authClose" type="button" aria-label="${copy('closeLanguage')}">✕</button>
          </div>
          <form class="hansora-auth-form" id="authForm">
            <div class="hansora-oauth-stack">
              <button class="btn hansora-google-btn" id="btnGoogleLogin" type="button">
                <img alt="G" src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg">
                <span>${copy('google')}</span>
              </button>
              <button class="btn hansora-telegram-btn" id="btnTelegramLogin" type="button">
                <svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor"><path d="M21.8 3.2 18.6 20c-.24 1.19-.88 1.48-1.78.92l-4.87-3.59-2.35 2.26c-.26.26-.48.48-.98.48l.35-4.96 9.02-8.15c.39-.35-.09-.55-.61-.2L6.23 13.78l-4.8-1.5c-1.04-.33-1.06-1.04.22-1.54L20.4 3.52c.87-.32 1.63.2 1.4-.32Z"/></svg>
                <span>${copy('telegram')}</span>
              </button>
            </div>
            <p class="hansora-auth-msg" style="margin:12px 0 0;color:rgba(255,255,255,.72);line-height:1.45;">
              ${copy('secureAuth')}
            </p>
            <div class="hansora-auth-divider" style="display:none;"><span>${copy('or')}</span></div>
            <input id="authEmail" style="display:none;" placeholder="${copy('email')}" type="email" autocomplete="email">
            <input id="authPass" style="display:none;" placeholder="${copy('password')}" type="password" autocomplete="current-password">
            <div class="hansora-auth-actions" style="display:none;">
              <button class="btn btn-brand" id="btnDoLogin" type="button">${copy('logIn')}</button>
              <a class="btn" id="btnGoSignup" href="${siteHref('/login.html?mode=signup')}">${copy('signUp')}</a>
            </div>
            <p class="hansora-auth-msg" id="authMsg"></p>
          </form>
        </div>
      </div>`);
  }

  function el(id) { return document.getElementById(id); }

  function setCreditsDisplay(value) {
    const n = Number(value || 0);
    currentCredits = n;
    writeCache('credits', n);
    const navCredits = el('navCredits');
    if (navCredits) navCredits.textContent = formatCredits(n);
    updateVideoLandingLink();
  }

  function authProfileForUser(user) {
    const userMetadata = user && user.user_metadata ? user.user_metadata : {};
    const identities = user && Array.isArray(user.identities) ? user.identities : [];
    const telegramIdentity = identities.find(function (identity) {
      const identityData = identity && identity.identity_data ? identity.identity_data : {};
      return identity && (
        identity.provider === 'custom:telegram' ||
        identity.provider === 'telegram' ||
        identityData.iss === 'https://oauth.telegram.org'
      );
    }) || null;
    const identityData = telegramIdentity && telegramIdentity.identity_data
      ? telegramIdentity.identity_data
      : {};
    const metadata = Object.assign({}, identityData, userMetadata);
    const appProvider = user && user.app_metadata ? String(user.app_metadata.provider || '') : '';
    const isTelegram = Boolean(
      telegramIdentity ||
      appProvider === 'custom:telegram' ||
      appProvider === 'telegram' ||
      metadata.iss === 'https://oauth.telegram.org'
    );
    const telegramUserId = isTelegram
      ? String(metadata.sub || metadata.telegram_user_id || metadata.id || (telegramIdentity && telegramIdentity.id) || '')
      : '';
    const telegramUsername = isTelegram
      ? String(metadata.preferred_username || metadata.username || '').replace(/^@/, '').slice(0, 64)
      : '';
    const displayName = String(
      metadata.full_name ||
      metadata.name ||
      [metadata.first_name, metadata.last_name].filter(Boolean).join(' ') ||
      telegramUsername ||
      (user && user.email) ||
      'Hansora User'
    ).trim().slice(0, 160);
    const avatarUrl = String(
      metadata.avatar_url ||
      metadata.picture ||
      metadata.photo_url ||
      metadata.avatar ||
      ''
    ).slice(0, 1000);
    return {
      isTelegram: isTelegram,
      authProvider: isTelegram ? 'telegram' : (appProvider || 'google'),
      email: isTelegram
        ? (telegramUserId || null)
        : (user && user.email ? user.email : null),
      telegramUserId: telegramUserId || null,
      telegramUsername: telegramUsername || null,
      displayName: displayName || null,
      avatarUrl: avatarUrl || null
    };
  }

  function avatarUrlFor(user) {
    const authProfile = authProfileForUser(user);
    const fallbackName = authProfile.displayName || authProfile.telegramUsername || authProfile.email || 'Hansora';
    return authProfile.avatarUrl || `https://ui-avatars.com/api/?name=${encodeURIComponent(fallbackName.slice(0, 1).toUpperCase())}&background=6366f1&color=fff`;
  }

  function showLoggedInUI(profile, user) {
    currentUser = user || null;
    promoteAiCourseOriginForAuthenticatedUser();
    removeAnalyticsConsentBanner();
    const header = el('siteHeader');
    const loginBtn = el('btnLoginSignup');
    const navCredits = el('navCredits');
    const navAvatar = el('navAvatar');
    const navAvatarImg = el('navAvatarImg');
    if (header) header.classList.remove('auth-checking');
    if (loginBtn) loginBtn.style.display = 'none';
    if (navCredits) navCredits.style.display = 'inline-flex';
    if (navAvatar) navAvatar.style.display = 'inline-flex';
    if (navAvatarImg && user) {
      navAvatarImg.src = avatarUrlFor(user);
      writeCache('avatar', navAvatarImg.src);
    }
    writeCache('loggedIn', '1');
    setCreditsDisplay(profile && profile.credits != null ? profile.credits : 0);
  }

  function showLoggedOutUI() {
    currentUser = null;
    currentCredits = 0;
    analyticsAuthCache = null;
    window.__hansoraAnalyticsAuth = null;
    clearSubscriptionState();
    const header = el('siteHeader');
    const loginBtn = el('btnLoginSignup');
    const navCredits = el('navCredits');
    const navAvatar = el('navAvatar');
    const navMenu = el('navMenu');
    if (header) header.classList.remove('auth-checking');
    if (loginBtn) loginBtn.style.display = 'inline-flex';
    if (navCredits) navCredits.style.display = 'none';
    if (navAvatar) navAvatar.style.display = 'none';
    if (navMenu) navMenu.classList.remove('is-open');
    clearCache();
    updateVideoLandingLink();
    injectAnalyticsConsentBanner();
    redirectLoggedOutHome();
  }

  let authMode = 'login';

  function setAuthMode(mode) {
    authMode = mode === 'signup' ? 'signup' : 'login';
    const title = el('authTitle');
    const msg = el('authMsg');
    if (title) title.textContent = authMode === 'signup' ? copy('createAccount') : copy('logIn');
    if (msg) msg.textContent = '';
  }

  function openAuth(mode) {
    if (mode) setAuthMode(mode);
    const modal = el('authModal');
    const msg = el('authMsg');
    if (msg) msg.textContent = '';
    if (modal) {
      modal.classList.add('is-open');
      modal.setAttribute('aria-hidden', 'false');
    }
  }

  function closeAuth() {
    const modal = el('authModal');
    const msg = el('authMsg');
    if (msg) msg.textContent = '';
    if (modal) {
      modal.classList.remove('is-open');
      modal.setAttribute('aria-hidden', 'true');
    }
  }

  function rememberTelegramOAuthStart() {
    try {
      localStorage.setItem(TELEGRAM_OAUTH_STARTED_KEY, String(Date.now()));
    } catch (_) {}
  }

  function clearTelegramOAuthStart() {
    try {
      localStorage.removeItem(TELEGRAM_OAUTH_STARTED_KEY);
    } catch (_) {}
  }

  function telegramOAuthWasStarted() {
    try {
      const startedAt = Number(localStorage.getItem(TELEGRAM_OAUTH_STARTED_KEY) || 0);
      if (!Number.isFinite(startedAt) || startedAt <= 0) return false;
      if (Date.now() - startedAt > 30 * 60 * 1000) {
        localStorage.removeItem(TELEGRAM_OAUTH_STARTED_KEY);
        return false;
      }
      return true;
    } catch (_) {
      return false;
    }
  }

  function telegramOAuthReturnError() {
    if (!telegramOAuthWasStarted()) return '';
    try {
      const query = new URLSearchParams(location.search || '');
      const hash = new URLSearchParams(String(location.hash || '').replace(/^#/, ''));
      return String(
        query.get('error_description') || query.get('error') ||
        hash.get('error_description') || hash.get('error') || ''
      ).replace(/\+/g, ' ').trim();
    } catch (_) {
      return '';
    }
  }

  function cleanOAuthErrorFromUrl() {
    try {
      const url = new URL(location.href);
      ['error', 'error_code', 'error_description'].forEach(function (key) {
        url.searchParams.delete(key);
      });
      const hash = new URLSearchParams(String(url.hash || '').replace(/^#/, ''));
      ['error', 'error_code', 'error_description'].forEach(function (key) {
        hash.delete(key);
      });
      url.hash = hash.toString() ? `#${hash.toString()}` : '';
      history.replaceState(history.state, document.title, `${url.pathname}${url.search}${url.hash}`);
    } catch (_) {}
  }

  function showTelegramOAuthFailure(detail) {
    clearTelegramOAuthStart();
    cleanOAuthErrorFromUrl();
    const button = el('btnTelegramLogin');
    if (button) {
      button.disabled = false;
      button.removeAttribute('aria-busy');
    }
    openAuth('login');
    const msg = el('authMsg');
    if (msg) {
      const safeDetail = String(detail || '').slice(0, 240);
      msg.textContent = safeDetail
        ? `${copy('telegramFailure')}: ${safeDetail}`
        : copy('telegramCancelled');
    }
  }

  async function getOrCreateProfile(user) {
    if (!sb || !user) throw new Error(copy('notLoggedIn'));
    const authProfile = authProfileForUser(user);
    const { data, error } = await sb
      .from('profiles')
      .select('user_id,email,credits,monthly_credits,payg_credits')
      .eq('user_id', user.id)
      .maybeSingle();
    if (error) throw error;
    if (!data) {
      const profileInsert = {
        user_id: user.id,
        email: authProfile.email,
        credits: 3,
        monthly_credits: 0,
        payg_credits: 3
      };
      if (authProfile.isTelegram) {
        Object.assign(profileInsert, {
          auth_provider: 'telegram',
          telegram_user_id: authProfile.telegramUserId,
          telegram_username: authProfile.telegramUsername,
          display_name: authProfile.displayName,
          avatar_url: authProfile.avatarUrl
        });
      }
      const ins = await sb.from('profiles').insert(profileInsert).select('user_id,email,credits').single();
      if (ins.error) throw ins.error;
      try {
        localStorage.removeItem(offerDismissedKey(user));
        localStorage.removeItem(offerPendingKey(user));
      } catch (_) {}
      return { ...ins.data, __hansoraNewSignup: true };
    }
    if (authProfile.isTelegram) {
      const telegramProfileUpdate = {
        email: authProfile.email,
        auth_provider: 'telegram',
        telegram_user_id: authProfile.telegramUserId,
        telegram_username: authProfile.telegramUsername,
        display_name: authProfile.displayName,
        avatar_url: authProfile.avatarUrl
      };
      const updateResult = await sb.from('profiles').update(telegramProfileUpdate).eq('user_id', user.id);
      if (updateResult.error) console.warn('Telegram profile metadata update failed', updateResult.error);
    }
    const credits = Number(data.credits || 0);
    const monthlyCredits = Number(data.monthly_credits || 0);
    const paygCredits = Number(data.payg_credits || 0);
    const missingBucketCredits = Number((credits - monthlyCredits - paygCredits).toFixed(2));
    if (missingBucketCredits > 0) {
      const repairedPaygCredits = Number((paygCredits + missingBucketCredits).toFixed(2));
      const repair = await sb
        .from('profiles')
        .update({ payg_credits: repairedPaygCredits })
        .eq('user_id', user.id);
      if (repair.error) throw repair.error;
      data.payg_credits = repairedPaygCredits;
    }
    const profileCreatedAt = await getProfileCreatedAt(user.id);
    return profileCreatedAt ? { ...data, __hansoraProfileCreatedAt: profileCreatedAt } : data;
  }

  async function getProfileCreatedAt(userId) {
    if (!sb || !userId) return '';
    try {
      const { data, error } = await sb
        .from('profiles')
        .select('updated_at')
        .eq('user_id', userId)
        .maybeSingle();
      if (error) return '';
      return data && data.updated_at ? String(data.updated_at) : '';
    } catch (_) {
      return '';
    }
  }

  async function getUserId() {
    if (!sb) return null;
    const { data } = await sb.auth.getUser();
    return data && data.user ? data.user.id : null;
  }

  function normalizeSubscriptionValue(value) {
    return String(value || '')
      .trim()
      .toLowerCase()
      .replace(/[_\s]+/g, '-')
      .replace(/[^a-z0-9.-]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
  }

  function normalizeQuality(value) {
    const text = normalizeSubscriptionValue(value);
    if (text === '1-k') return '1k';
    if (text === '2-k') return '2k';
    return text.replace('-', '');
  }

  function normalizeResolution(value) {
    const text = normalizeSubscriptionValue(value);
    if (!text) return '';
    const match = text.match(/(720|1080|2160|4k)/);
    if (!match) return text;
    return match[1] === '4k' ? '4k' : `${match[1]}p`;
  }

  function normalizeDuration(value) {
    if (value == null || value === '') return null;
    if (typeof value === 'number' && Number.isFinite(value)) return Math.round(value);
    const match = String(value).match(/(\d+(?:\.\d+)?)/);
    return match ? Math.round(Number(match[1])) : null;
  }

  function ruleIsConstrained(rule) {
    return Boolean(
      (rule.qualities && rule.qualities.length) ||
      (rule.resolutions && rule.resolutions.length) ||
      (rule.durations && rule.durations.length)
    );
  }

  function ruleDisplayName(rule) {
    const parts = [rule.label || rule.key];
    if (rule.qualities && rule.qualities.length) parts.push(rule.qualities.join('-').toUpperCase());
    if (rule.resolutions && rule.resolutions.length) parts.push(rule.resolutions.join('-'));
    if (rule.durations && rule.durations.length) parts.push(`${rule.durations.join('-')}s`);
    return parts.join(' ');
  }

  function fallbackRulesFromLabels(labels) {
    return (Array.isArray(labels) ? labels : []).map(function (label) {
      const text = String(label || '').trim();
      return {
        key: normalizeSubscriptionValue(text),
        label: text,
        type: '',
        models: [text]
      };
    }).filter(function (rule) { return rule.key; });
  }

  function subscriptionRulesFor(planId, labels) {
    return SUBSCRIPTION_PLAN_RULES[planId] || fallbackRulesFromLabels(labels);
  }

  function buildSubscriptionState(row) {
    const now = Date.now();
    const endMs = row && row.current_period_end ? Date.parse(row.current_period_end) : 0;
    const active = Boolean(
      row &&
      row.status === 'active' &&
      Number.isFinite(endMs) &&
      endMs > now
    );
    if (!active) {
      return {
        active: false,
        status: row && row.status ? row.status : 'inactive',
        planId: row && row.plan_id ? row.plan_id : null,
        currentPeriodEnd: row && row.current_period_end ? row.current_period_end : null,
        cancelAtPeriodEnd: Boolean(row && row.cancel_at_period_end),
        unlimitedModels: [],
        unlimitedModelKeys: [],
        rules: []
      };
    }
    const rules = subscriptionRulesFor(row.plan_id, row.unlimited_models);
    return {
      active: true,
      status: row.status,
      planId: row.plan_id,
      currentPeriodEnd: row.current_period_end || null,
      cancelAtPeriodEnd: Boolean(row.cancel_at_period_end),
      unlimitedModels: rules.map(ruleDisplayName),
      unlimitedModelKeys: rules.map(function (rule) { return rule.key; }),
      rules: rules.map(function (rule) {
        return {
          key: rule.key,
          label: rule.label,
          type: rule.type || '',
          qualities: rule.qualities || [],
          resolutions: rule.resolutions || [],
          durations: rule.durations || []
        };
      })
    };
  }

  function publishSubscriptionState(state) {
    currentSubscription = state || buildSubscriptionState(null);
    window.HANSORA_SUBSCRIPTION = currentSubscription;
    window.HANSORA_UNLIMITED_MODELS = currentSubscription.unlimitedModelKeys || [];
    window.dispatchEvent(new CustomEvent('hansora:subscription-updated', { detail: currentSubscription }));
    return currentSubscription;
  }

  function clearSubscriptionState() {
    subscriptionLoadedAt = 0;
    subscriptionUserId = null;
    subscriptionPromise = null;
    publishSubscriptionState(buildSubscriptionState(null));
  }

  function requestFromModelInput(input, options) {
    const source = input && typeof input === 'object' ? input : { model: input };
    const extra = options && typeof options === 'object' ? options : {};
    const model = source.model || source.modelId || source.selectedModel || source.id || source.label || source.name || '';
    const quality = source.quality || source.size || source.outputQuality || source.resolution || extra.quality || extra.size || '';
    const resolution = source.resolution || source.quality || source.size || extra.resolution || '';
    const duration = source.duration || source.seconds || source.durationSeconds || source.length || extra.duration || extra.seconds || extra.durationSeconds || null;
    return {
      raw: input,
      model: normalizeSubscriptionValue(model),
      quality: normalizeQuality(quality),
      resolution: normalizeResolution(resolution),
      duration: normalizeDuration(duration)
    };
  }

  function ruleMatchesRequest(rule, request) {
    const aliases = (rule.models || []).map(normalizeSubscriptionValue);
    const rawKey = normalizeSubscriptionValue(request.raw);
    if (typeof request.raw === 'string') {
      const exactCandidates = [rule.key, ruleDisplayName(rule)].map(normalizeSubscriptionValue);
      if (!ruleIsConstrained(rule)) {
        exactCandidates.push(rule.label, ...(rule.models || []));
      }
      if (exactCandidates.map(normalizeSubscriptionValue).includes(rawKey)) return true;
    }
    if (!request.model || !aliases.includes(request.model)) return false;
    if (rule.qualities && rule.qualities.length && !rule.qualities.map(normalizeQuality).includes(request.quality)) return false;
    if (rule.resolutions && rule.resolutions.length && !rule.resolutions.map(normalizeResolution).includes(request.resolution)) return false;
    if (rule.durations && rule.durations.length && !rule.durations.includes(request.duration)) return false;
    return true;
  }

  function isUnlimitedModel(input, options) {
    const state = currentSubscription;
    if (!state || !state.active) return false;
    const rules = subscriptionRulesFor(state.planId, state.unlimitedModels);
    const request = requestFromModelInput(input, options);
    return rules.some(function (rule) { return ruleMatchesRequest(rule, request); });
  }

  async function loadSubscriptionForUser(user, options) {
    if (!sb || !user || !user.id) {
      clearSubscriptionState();
      return currentSubscription;
    }
    const force = Boolean(options && options.force);
    const now = Date.now();
    if (!force && subscriptionUserId === user.id && currentSubscription && now - subscriptionLoadedAt < SUBSCRIPTION_CACHE_MS) {
      return currentSubscription;
    }
    if (!force && subscriptionUserId === user.id && subscriptionPromise) return subscriptionPromise;
    subscriptionUserId = user.id;
    subscriptionPromise = (async function () {
      const { data, error } = await sb
        .from('user_subscriptions')
        .select('status,plan_id,unlimited_models,current_period_end,cancel_at_period_end,updated_at')
        .eq('user_id', user.id)
        .maybeSingle();
      if (error) throw error;
      subscriptionLoadedAt = Date.now();
      return publishSubscriptionState(buildSubscriptionState(data));
    })();
    try {
      return await subscriptionPromise;
    } catch (error) {
      console.warn('Hansora subscription read failed', error);
      return publishSubscriptionState(buildSubscriptionState(null));
    } finally {
      subscriptionPromise = null;
    }
  }

  async function refreshCredits() {
    if (!sb) return currentCredits;
    const { data } = await sb.auth.getUser();
    const user = data && data.user ? data.user : null;
    if (!user) {
      showLoggedOutUI();
      return 0;
    }
    const { data: prof, error } = await sb
      .from('profiles')
      .select('credits')
      .eq('user_id', user.id)
      .maybeSingle();
    if (error) throw error;
    const next = prof && prof.credits != null ? prof.credits : 0;
    setCreditsDisplay(next);
    return next;
  }

  async function setCredits(value) {
    const uid = await getUserId();
    if (!uid) throw new Error(copy('notLoggedIn'));
    const { error } = await sb
      .from('profiles')
      .update({ credits: value })
      .eq('user_id', uid);
    if (error) throw error;
    setCreditsDisplay(value);
    return value;
  }

  async function addCredits(delta) {
    const current = await refreshCredits();
    const next = Number(current || 0) + Number(delta || 0);
    await setCredits(next);
    return next;
  }

  async function useCredits(cost) {
    const current = await refreshCredits();
    const amount = Number(cost || 0);
    if (Number(current || 0) < amount) throw new Error(copy('notEnoughCredits'));
    const next = Number(current || 0) - amount;
    await setCredits(next);
    return next;
  }

  function startCreditsPolling(durationMs = 180000, intervalMs = 2000) {
    if (window.__creditsPoll) clearInterval(window.__creditsPoll);
    const started = Date.now();
    window.__creditsPoll = setInterval(async function () {
      try { await refreshCredits(); } catch (error) { console.warn('credits poll read failed', error); }
      if (Date.now() - started > durationMs) clearInterval(window.__creditsPoll);
    }, intervalMs);
  }

  function inOfferPopupFrame() {
    try {
      return window.self !== window.top || new URLSearchParams(location.search || '').get('offer_popup') === '1';
    } catch (_) {
      return false;
    }
  }

  function applyOfferPopupPageMode() {
    try {
      if (new URLSearchParams(location.search || '').get('offer_popup') !== '1') return false;
      document.documentElement.classList.add('hansora-pricing-popup');
      if (document.body) document.body.classList.add('hansora-pricing-popup');
      return true;
    } catch (_) {
      return false;
    }
  }

  function offerPendingKey(user) {
    return user && user.id ? `${SIGNUP_OFFER_PENDING_PREFIX}${user.id}` : '';
  }

  function offerDismissedKey(user) {
    return user && user.id ? `${SIGNUP_OFFER_DISMISSED_PREFIX}${user.id}` : '';
  }

  function isSignupOfferDismissed(user) {
    const key = offerDismissedKey(user);
    if (!key) return true;
    try {
      return localStorage.getItem(key) === '1';
    } catch (_) {
      return false;
    }
  }

  function isRecentTimestamp(raw, windowMs) {
    if (!raw) return false;
    const createdAt = Date.parse(raw);
    if (!Number.isFinite(createdAt)) return false;
    return Date.now() - createdAt >= 0 && Date.now() - createdAt <= windowMs;
  }

  function isRecentlyCreatedUser(user) {
    return isRecentTimestamp(user && (user.created_at || user.createdAt), 30 * 60 * 1000);
  }

  function rememberSignupOfferOAuthStart() {
    try {
      localStorage.setItem(SIGNUP_OFFER_OAUTH_STARTED_KEY, String(Date.now()));
    } catch (_) {}
  }

  function consumeRecentSignupOfferOAuthStart() {
    try {
      const startedAt = Number(localStorage.getItem(SIGNUP_OFFER_OAUTH_STARTED_KEY) || 0);
      if (!Number.isFinite(startedAt) || startedAt <= 0) return false;
      localStorage.removeItem(SIGNUP_OFFER_OAUTH_STARTED_KEY);
      return Date.now() - startedAt >= 0 && Date.now() - startedAt <= 30 * 60 * 1000;
    } catch (_) {
      return false;
    }
  }

  function handleSignupOffer(user, profile) {
    if (profile && profile.__hansoraNewSignup) {
      scheduleSignupOffer(user, true);
      return;
    }
    if (profile && isRecentTimestamp(profile.__hansoraProfileCreatedAt, 30 * 60 * 1000)) {
      scheduleSignupOffer(user, false);
      return;
    }
    if (isRecentlyCreatedUser(user)) {
      scheduleSignupOffer(user, false);
      return;
    }
    if (consumeRecentSignupOfferOAuthStart()) {
      scheduleSignupOffer(user, false);
      return;
    }
    resumeSignupOffer(user);
  }

  function closeSignupOffer(user) {
    const modal = document.getElementById('hansoraSignupOffer');
    if (!modal) return;
    if (user && user.id) {
      try {
        localStorage.setItem(offerDismissedKey(user), '1');
        localStorage.removeItem(offerPendingKey(user));
      } catch (_) {}
    }
    modal.classList.add('is-closing');
    modal.classList.remove('is-open');
    setTimeout(function () {
      if (modal && modal.parentNode) modal.parentNode.removeChild(modal);
    }, 280);
  }

  function showSignupOffer(user, force) {
    if (!user || !user.id || inOfferPopupFrame()) return;
    if (!force && isSignupOfferDismissed(user)) return;
    if (document.getElementById('hansoraSignupOffer')) return;

    const modal = document.createElement('div');
    modal.id = 'hansoraSignupOffer';
    modal.className = 'hansora-offer-modal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-label', copy('creatorOffer'));
    modal.innerHTML = `
      <div class="hansora-offer-panel">
        <iframe class="hansora-offer-frame" src="${siteHref(SIGNUP_OFFER_URL)}" title="${copy('pricingOffer')}"></iframe>
        <button class="hansora-offer-close" type="button" aria-label="${copy('closeOffer')}">×</button>
      </div>`;
    document.body.appendChild(modal);

    const close = modal.querySelector('.hansora-offer-close');
    if (close) close.addEventListener('click', function () { closeSignupOffer(user); });
    modal.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') closeSignupOffer(user);
    });
    requestAnimationFrame(function () {
      modal.classList.add('is-open');
      if (close) close.focus({ preventScroll: true });
    });
  }

  function scheduleSignupOffer(user, forceNew) {
    if (!user || !user.id || inOfferPopupFrame()) return;
    if (forceNew) {
      try {
        localStorage.removeItem(offerDismissedKey(user));
        localStorage.removeItem(offerPendingKey(user));
      } catch (_) {}
    }
    if (isSignupOfferDismissed(user)) return;
    const key = offerPendingKey(user);
    if (!key) return;

    let deadline = 0;
    try {
      deadline = Number(localStorage.getItem(key) || 0);
      if (forceNew || !Number.isFinite(deadline) || deadline <= 0) {
        deadline = Date.now() + SIGNUP_OFFER_DELAY_MS;
        localStorage.setItem(key, String(deadline));
      }
    } catch (_) {
      deadline = Date.now() + SIGNUP_OFFER_DELAY_MS;
    }

    const wait = Math.max(0, deadline - Date.now());
    if (signupOfferTimer) clearTimeout(signupOfferTimer);
    signupOfferTimer = setTimeout(function () {
      showSignupOffer(user);
    }, wait);
  }

  function resumeSignupOffer(user) {
    if (!user || !user.id || inOfferPopupFrame() || isSignupOfferDismissed(user)) return;
    try {
      const deadline = Number(localStorage.getItem(offerPendingKey(user)) || 0);
      if (Number.isFinite(deadline) && deadline > 0) scheduleSignupOffer(user, false);
    } catch (_) {}
  }

  function bindEvents() {
    const navAvatar = el('navAvatar');
    const navMenu = el('navMenu');
    const btnLoginSignup = el('btnLoginSignup');
    const btnGetStarted = el('btnGetStarted');
    const btnAiCourse = el('btnAiCourse');
    const aiCourseModal = el('aiCourseModal');
    const aiCourseClose = el('aiCourseClose');
    const btnLanguage = el('btnLanguage');
    const languageModal = el('languageModal');
    const languageClose = el('languageClose');
    const btnLogout = el('btnLogout');
    const authClose = el('authClose');
    const doLogin = el('btnDoLogin');
    const btnGoogleLogin = el('btnGoogleLogin');
    const btnTelegramLogin = el('btnTelegramLogin');
    const modal = el('authModal');

    document.querySelectorAll('[data-hansora-model]').forEach(function (link) {
      link.addEventListener('click', function () {
        try {
          localStorage.setItem('hansora.search.selectedModel', link.getAttribute('data-hansora-model') || '');
        } catch (_) {}
      });
    });

    if (navAvatar && navMenu) {
      navAvatar.addEventListener('click', function (event) {
        event.stopPropagation();
        navMenu.classList.toggle('is-open');
      });
      document.addEventListener('click', function (event) {
        if (!navMenu.contains(event.target) && !navAvatar.contains(event.target)) navMenu.classList.remove('is-open');
      });
    }

    if (btnLoginSignup) btnLoginSignup.addEventListener('click', function (event) { event.preventDefault(); openAuth('login'); });
    if (btnGetStarted) {
      btnGetStarted.addEventListener('click', function (event) {
        if (currentUser || readCache('loggedIn') === '1') return;
        event.preventDefault();
        openAuth('signup');
      });
    }
    // Older pages still point their Start creating links to /login.html.
    // Keep those pages working while routing logged-out visitors to this popup.
    document.addEventListener('click', function (event) {
      const link = event.target.closest && event.target.closest('a');
      if (!link || currentUser || readCache('loggedIn') === '1') return;
      let legacyLoginLink = false;
      let signupMode = link.classList.contains('start-creating-link');
      try {
        const destination = new URL(link.href, location.href);
        legacyLoginLink = destination.origin === location.origin
          && (destination.pathname === '/login.html' || destination.pathname === '/login');
        signupMode = signupMode || destination.searchParams.get('mode') === 'signup';
      } catch (_) {}
      if (!signupMode && !legacyLoginLink) return;
      event.preventDefault();
      openAuth(signupMode ? 'signup' : 'login');
    }, true);
    function closeAiCourseModal() {
      if (!aiCourseModal) return;
      aiCourseModal.classList.remove('is-open');
      aiCourseModal.setAttribute('aria-hidden', 'true');
      document.body.style.removeProperty('overflow');
      if (btnAiCourse) btnAiCourse.focus({ preventScroll: true });
    }
    function openAiCourseModal() {
      if (!aiCourseModal) return;
      if (navMenu) navMenu.classList.remove('is-open');
      aiCourseModal.classList.add('is-open');
      aiCourseModal.setAttribute('aria-hidden', 'false');
      document.body.style.setProperty('overflow', 'hidden');
      if (aiCourseClose) aiCourseClose.focus({ preventScroll: true });
    }
    if (btnAiCourse) {
      btnAiCourse.addEventListener('click', function (event) {
        event.preventDefault();
        event.stopPropagation();
        openAiCourseModal();
      });
    }
    if (aiCourseClose) aiCourseClose.addEventListener('click', closeAiCourseModal);
    if (aiCourseModal) {
      aiCourseModal.addEventListener('click', function (event) {
        if (event.target === aiCourseModal) closeAiCourseModal();
      });
      aiCourseModal.querySelectorAll('[data-ai-course-path]').forEach(function (link) {
        link.addEventListener('click', function () {
          try {
            sessionStorage.setItem(AI_COURSE_SKIP_CAPTURE_KEY, link.getAttribute('data-ai-course-path') || '');
          } catch (_) {}
        });
      });
    }
    function closeLanguageModal() {
      if (!languageModal) return;
      languageModal.classList.remove('is-open');
      languageModal.setAttribute('aria-hidden', 'true');
      document.body.style.removeProperty('overflow');
      if (btnLanguage) btnLanguage.focus({ preventScroll: true });
    }
    function openLanguageModal() {
      if (!languageModal) return;
      if (navMenu) navMenu.classList.remove('is-open');
      languageModal.classList.add('is-open');
      languageModal.setAttribute('aria-hidden', 'false');
      document.body.style.setProperty('overflow', 'hidden');
      if (languageClose) languageClose.focus({ preventScroll: true });
    }
    if (btnLanguage) {
      btnLanguage.addEventListener('click', function (event) {
        event.preventDefault();
        event.stopPropagation();
        openLanguageModal();
      });
    }
    if (languageClose) languageClose.addEventListener('click', closeLanguageModal);
    if (languageModal) {
      languageModal.addEventListener('click', function (event) {
        if (event.target === languageModal) closeLanguageModal();
      });
      languageModal.querySelectorAll('[data-language-code]').forEach(function (button) {
        button.addEventListener('click', function () {
          const languageCode = button.getAttribute('data-language-code') || 'en';
          try { localStorage.setItem(LANGUAGE_STORAGE_KEY, languageCode); } catch (_) {}
          const destination = localizedHref(location.href, languageCode);
          if (destination === location.href || destination === `${location.pathname}${location.search}${location.hash}`) {
            closeLanguageModal();
            return;
          }
          window.location.assign(destination);
        });
      });
    }
    if (authClose) authClose.addEventListener('click', closeAuth);
    if (modal) {
      modal.addEventListener('click', function (event) {
        if (event.target === modal) closeAuth();
      });
    }
    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') {
        closeAuth();
        closeAiCourseModal();
        closeLanguageModal();
      }
    });

    if (btnGoogleLogin) {
      btnGoogleLogin.addEventListener('click', async function () {
        const msg = el('authMsg');
        if (msg) msg.textContent = copy('openingGoogle');
        let authAttempt = null;
        try {
          const attribution = rememberSignupAttributionStart();
          authAttempt = beginAuthFunnelAttempt('google', attribution);
          await recordAuthFunnelEvent('auth_google_clicked', authAttempt);
          captureAffiliateRef();
          const ref = getStoredAffiliateRef();
          if (ref) rememberAffiliateRef(ref, 'google_oauth');
          rememberSignupOfferOAuthStart();
          const { error } = await sb.auth.signInWithOAuth({
            provider: 'google',
            options: { redirectTo: oauthReturnUrl() }
          });
          if (error) throw error;
        } catch (error) {
          await recordAuthFunnelFailure(error, authAttempt);
          if (msg) msg.textContent = error.message || copy('googleFailed');
        }
      });
    }

    if (btnTelegramLogin) {
      btnTelegramLogin.addEventListener('click', async function () {
        const msg = el('authMsg');
        if (msg) msg.textContent = copy('openingTelegram');
        btnTelegramLogin.disabled = true;
        btnTelegramLogin.setAttribute('aria-busy', 'true');
        let authAttempt = null;
        try {
          const attribution = rememberSignupAttributionStart();
          authAttempt = beginAuthFunnelAttempt('telegram', attribution);
          await recordAuthFunnelEvent('auth_telegram_clicked', authAttempt);
          captureAffiliateRef();
          const ref = getStoredAffiliateRef();
          if (ref) rememberAffiliateRef(ref, 'telegram_oauth');
          rememberSignupOfferOAuthStart();
          rememberTelegramOAuthStart();
          const { error } = await sb.auth.signInWithOAuth({
            provider: 'custom:telegram',
            options: { redirectTo: oauthReturnUrl() }
          });
          if (error) throw error;
        } catch (error) {
          await recordAuthFunnelFailure(error, authAttempt);
          showTelegramOAuthFailure(error && error.message ? error.message : copy('tryAgain'));
        }
      });
    }

    if (doLogin) {
      doLogin.addEventListener('click', async function () {
        const emailIn = el('authEmail');
        const passIn = el('authPass');
        const msg = el('authMsg');
        if (!emailIn.value || !passIn.value) { if (msg) msg.textContent = copy('enterCredentials'); return; }
        if (msg) msg.textContent = copy('signingIn');
        try {
          const { data, error } = await sb.auth.signInWithPassword({ email: emailIn.value.trim(), password: passIn.value.trim() });
          if (error) { if (msg) msg.textContent = error.message; return; }
          const profile = await getOrCreateProfile(data.user);
          showLoggedInUI(profile, data.user);
          await registerAffiliateReferral(data.user);
          handleSignupOffer(data.user, profile);
          closeAuth();
        } catch (error) {
          if (msg) msg.textContent = error.message || copy('loginFailed');
        }
      });
    }

    if (btnLogout) {
      btnLogout.addEventListener('click', async function () {
        if (sb) await sb.auth.signOut();
        window.location.replace(localizedHref('/index.html'));
      });
    }
  }

  async function restoreSession() {
    if (!sb) {
      showLoggedOutUI();
      return;
    }
    try {
      const { data } = await sb.auth.getUser();
      const user = data && data.user ? data.user : null;
      if (!user) {
        showLoggedOutUI();
        if (telegramOAuthWasStarted()) {
          showTelegramOAuthFailure(telegramOAuthReturnError());
        }
        return;
      }
      await handleAuthenticatedUser(user);
    } catch (error) {
      console.warn('Hansora header session restore failed', error);
      showLoggedOutUI();
    }
  }

  async function handleAuthenticatedUser(user) {
    if (!user) return null;
    const authAttempt = readAuthFunnelAttempt();
    clearTelegramOAuthStart();
    const pendingCourseReturn = getPendingAiCourseOrigin();
    const pendingAttribution = readSignupAttributionStart();
    if (pendingAttribution) restoreExistingAnalyticsSessionId(pendingAttribution.sessionId);
    refreshAnalyticsAuthCache();
    let profile;
    try {
      profile = await getOrCreateProfile(user);
    } catch (error) {
      await recordAuthFunnelFailure(
        `Profile creation failed: ${error && error.message ? error.message : 'unknown error'}`,
        authAttempt,
        user.id
      );
      throw error;
    }
    showLoggedInUI(profile, user);
    if (pendingCourseReturn && normalizeAiCoursePath(location.pathname) !== pendingCourseReturn) {
      window.location.replace(pendingCourseReturn);
      return profile;
    }
    const authSuccessWrite = authCallbackArrivalWrite.then(function () {
      return recordAuthFunnelEvent('auth_success', authAttempt, {
        userId: user.id
      });
    });
    const attributionWrite = recordSignupAttribution(user).catch(function (error) {
      console.warn('Hansora signup attribution failed', error);
      return false;
    });
    const authSuccessRecorded = await authSuccessWrite;
    await attributionWrite;
    if (authAttempt && (profile.__hansoraNewSignup || isRecentlyCreatedAccount(user))) {
      const registrationRecorded = await recordAuthFunnelEvent(
        'registration_completed',
        authAttempt,
        { userId: user.id }
      );
      if (registrationRecorded) clearAuthFunnelAttempt();
    } else if (authSuccessRecorded) {
      clearAuthFunnelAttempt();
    }
    loadSubscriptionForUser(user).catch(function (error) {
      console.warn('Hansora subscription background read failed', error);
    });
    await registerAffiliateReferral(user);
    handleSignupOffer(user, profile);
    return profile;
  }

  function bindAuthStateChanges() {
    if (!sb || !sb.auth || typeof sb.auth.onAuthStateChange !== 'function') return;
    sb.auth.onAuthStateChange(function (event, session) {
      const user = session && session.user ? session.user : null;
      if (!user) {
        if (event === 'SIGNED_OUT') showLoggedOutUI();
        return;
      }
      setTimeout(function () {
        handleAuthenticatedUser(user).catch(function (error) {
          console.warn('Hansora auth state handling failed', error);
        });
      }, 0);
    });
  }

  function exposeApi() {
    if (!currentSubscription) publishSubscriptionState(buildSubscriptionState(null));
    window.HansoraHeader = {
      refreshCredits,
      setCredits: setCreditsDisplay,
      saveCredits: setCredits,
      addCredits,
      useCredits,
      refreshSubscription: function () {
        return currentUser ? loadSubscriptionForUser(currentUser, { force: true }) : Promise.resolve(currentSubscription);
      },
      getSubscription: function () { return currentSubscription; },
      isUnlimitedModel,
      getCurrentUser: function () { return currentUser; },
      getCurrentCredits: function () { return currentCredits; },
      openAuth,
      closeAuth,
      startCreditsPolling,
      showSignupOfferNow: function () {
        const user = currentUser || { id: 'debug' };
        showSignupOffer(user, true);
      },
      showPricingOfferNow: function () {
        const user = currentUser || { id: 'pricing-offer' };
        showSignupOffer(user, true);
      },
      resetSignupOffer: function () {
        const user = currentUser;
        if (!user || !user.id) return false;
        try {
          localStorage.removeItem(offerDismissedKey(user));
          localStorage.removeItem(offerPendingKey(user));
          localStorage.removeItem(SIGNUP_OFFER_OAUTH_STARTED_KEY);
        } catch (_) {}
        return true;
      }
    };
    window.refreshCredits = refreshCredits;
    window.hansoraCredits = { addCredits, useCredits, setCredits };
    window.hansoraSubscription = {
      refresh: window.HansoraHeader.refreshSubscription,
      get: window.HansoraHeader.getSubscription,
      isUnlimitedModel
    };
  }

  captureAffiliateRef();
  captureAiCourseOrigin();

  ready(function () {
    captureAffiliateRef();
    captureAiCourseOrigin();
    applyOfferPopupPageMode();
    applyTelegramViewportFix();
    injectHeaderStyles();
    injectHeader();
    injectAuthModal();
    ensureSupabaseClient();
    exposeApi();
    bindEvents();
    bindGlobalClickTracking();
    bindCoursePreviewFunnelTracking();
    preserveAffiliateRefAcrossPageLinks();
    authCallbackArrivalWrite = captureAuthCallbackArrival().catch(function (error) {
      console.warn('Hansora auth callback tracking failed', error);
      return false;
    });
    bindAuthStateChanges();
    restoreSession().finally(initializeRegionalAnalyticsConsent);
  });
})();
