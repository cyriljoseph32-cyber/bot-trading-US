import React, { useState, useEffect, useRef, useCallback } from "react";

/* ─── DESIGN TOKENS ─────────────────────────────────────────────────────── */
const C = {
tealDeep: "#0B3535", teal: "#1B6B6B", tealMid: "#155555",
tealLight: "#2A9090", tealPale: "#E8F5F5",
coral: "#E8724A", coralLight: "#F4956D",
sand: "#E8C97A", sandLight: "#F5E3A8",
cream: "#FAF3E6", white: "#FFFFFF",
textDark: "#1A2E2E", textMid: "#3D6060", textLight: "#6B9090",
border: "#C5E0E0",
};

/* ─── COPY (FR / EN) ────────────────────────────────────────────────────── */
const T = {
fr: {
nav_demo: "Voir la démo", nav_hotels: "Hôtels partenaires", nav_pricing: "Tarifs",
hero_tag: "Intelligence locale • Koh Samui",
hero_h1: "Votre concierge IA local\nsur Koh Samui 🥥",
hero_sub: "Coco connaît chaque plage, chaque restaurant, chaque site de plongée. Disponible 24h/24, en 6 langues, prêt à s'intégrer sur votre site hôtelier.",
hero_cta1: "Essayer Coco gratuitement", hero_cta2: "Pour les hôtels →",
stats: [
{ n: "42", l: "hôtels répertoriés" }, { n: "48", l: "restaurants" },
{ n: "15", l: "sites de plongée" }, { n: "6", l: "langues" },
],
feat_h2: "Tout ce que Coco sait faire",
features: [
{ icon: "🤿", t: "Expert plongée local", d: "Sail Rock, Chumphon Pinnacle, 15 sites de plongée — conseils d'instructeur PADI professionnel." },
{ icon: "🌦️", t: "Météo adaptative", d: "Si la mer est agitée, Coco bascule automatiquement vers spa, temples et cours de cuisine." },
{ icon: "👨‍👩‍👧", t: "Profils sur mesure", d: "Famille avec enfants, lune de miel, solo aventurier — recommandations personnalisées en temps réel." },
{ icon: "💬", t: "6 langues", d: "Français, English, Русский, Deutsch, Svenska, 中文 — détection automatique de la langue." },
{ icon: "🏨", t: "Widget hôtel blanc", d: "3 lignes de code pour intégrer Coco sur votre site. Couleurs et nom personnalisables." },
{ icon: "📊", t: "Leads trackés", d: "Chaque réservation générée est tracée. Rapport mensuel inclus dans l'abonnement." },
],
demo_h2: "Essayez Coco maintenant",
demo_sub: "Posez n'importe quelle question sur Koh Samui — plages, hôtels, plongée, restaurants, itinéraires...",
demo_placeholder: "Ex: Je cherche un hotel romantique avec vue mer...",
hotels_h2: "Pour les hôtels & resorts",
hotels_sub: "Offrez à vos clients un concierge IA disponible 24h/24, multilingue, qui connaît Samui comme un local.",
hotels_features: [
"Widget intégrable en 3 lignes de code",
"Couleurs et nom de votre marque",
"Recommandations prioritaires pour votre hôtel",
"Rapport mensuel des leads générés",
"Support WhatsApp prioritaire",
"Essai gratuit 14 jours — sans engagement",
],
hotels_price: "3 500 THB / mois",
hotels_cta: "Demander une démo →",
how_h2: "Comment ça marche",
steps: [
{ n: "1", t: "Votre client arrive", d: "Un voyageur visite votre site hôtelier. Il voit le widget Coco en bas à droite." },
{ n: "2", t: "Il pose sa question", d: "\"Où dîner romantique ce soir ?\" — Coco répond instantanément en 6 langues." },
{ n: "3", t: "Coco recommande", d: "Basé sur le profil, la météo, la saison — 3 recommandations personnalisées avec prix en THB." },
{ n: "4", t: "Vous mesurez", d: "Chaque interaction trackée. Rapport mensuel avec leads et satisfactions." },
],
pricing_h2: "Tarifs simples",
plans: [
{ name: "Essai", price: "Gratuit", duration: "14 jours", features: ["Widget full fonctionnel", "50 conversations incluses", "Support email"], cta: "Démarrer l'essai", highlight: false },
{ name: "Partenaire", price: "3 500 THB", duration: "/ mois", features: ["Conversations illimitées", "6 langues", "Widget marque blanche", "Rapport mensuel leads", "Support WhatsApp prioritaire"], cta: "Contacter →", highlight: true },
{ name: "Sur mesure", price: "Nous contacter", duration: "", features: ["Réseau d'hôtels", "API directe", "Intégrations sur mesure", "SLA garanti"], cta: "Discutons →", highlight: false },
],
faq_h2: "Questions fréquentes",
faqs: [
{ q: "Coco parle-t-il vraiment 6 langues ?", a: "Oui — français, anglais, russe, allemand, suédois, chinois. Détection automatique dès le premier message." },
{ q: "Faut-il des compétences techniques pour intégrer le widget ?", a: "Non. Un copier-coller de 3 lignes de HTML suffit. Nous gérons tout le reste." },
{ q: "Les données de mes clients sont-elles protégées ?", a: "Coco ne stocke aucune donnée personnelle. Les conversations ne sont pas archivées." },
{ q: "Que se passe-t-il à la fin des 14 jours d'essai ?", a: "Le widget se désactive automatiquement. Aucune facturation sans votre accord." },
],
footer_tagline: "L'intelligence locale de Koh Samui",
footer_contact: "Contact & partenariats :",
cta_final_h2: "Prêt à offrir une expérience locale à vos clients ?",
cta_final_sub: "Essai gratuit 14 jours — aucune carte bancaire requise.",
cta_final_btn: "Démarrer maintenant →",
},
en: {
nav_demo: "Try demo", nav_hotels: "Hotel partners", nav_pricing: "Pricing",
hero_tag: "Local intelligence • Koh Samui",
hero_h1: "Your local AI concierge\non Koh Samui 🥥",
hero_sub: "Coco knows every beach, restaurant, and dive site. Available 24/7 in 6 languages, ready to embed on your hotel website.",
hero_cta1: "Try Coco for free", hero_cta2: "For hotels →",
stats: [
{ n: "42", l: "listed hotels" }, { n: "48", l: "restaurants" },
{ n: "15", l: "dive sites" }, { n: "6", l: "languages" },
],
feat_h2: "Everything Coco knows",
features: [
{ icon: "🤿", t: "Local dive expert", d: "Sail Rock, Chumphon Pinnacle, 15 dive sites — advice from a professional PADI instructor." },
{ icon: "🌦️", t: "Weather-adaptive", d: "If the sea is rough, Coco automatically pivots to spas, temples and cooking classes." },
{ icon: "👨‍👩‍👧", t: "Personalized profiles", d: "Family with kids, honeymoon, solo adventure — tailored recommendations in real time." },
{ icon: "💬", t: "6 languages", d: "French, English, Russian, German, Swedish, Chinese — automatic language detection." },
{ icon: "🏨", t: "White-label widget", d: "3 lines of code to embed Coco on your site. Colors and name fully customizable." },
{ icon: "📊", t: "Lead tracking", d: "Every referral tracked. Monthly report included in your subscription." },
],
demo_h2: "Try Coco now",
demo_sub: "Ask anything about Koh Samui — beaches, hotels, diving, restaurants, itineraries...",
demo_placeholder: "E.g. I'm looking for a romantic sea-view hotel...",
hotels_h2: "For hotels & resorts",
hotels_sub: "Give your guests a 24/7 multilingual AI concierge that knows Samui like a local.",
hotels_features: [
"Embeddable widget in 3 lines of code",
"Your brand colors and name",
"Priority recommendations for your hotel",
"Monthly lead generation report",
"Priority WhatsApp support",
"Free 14-day trial — no commitment",
],
hotels_price: "3,500 THB / month",
hotels_cta: "Request a demo →",
how_h2: "How it works",
steps: [
{ n: "1", t: "Guest arrives", d: "A traveler visits your hotel website. They see the Coco widget in the bottom right." },
{ n: "2", t: "They ask a question", d: "\"Where to have a romantic dinner?\" — Coco answers instantly in 6 languages." },
{ n: "3", t: "Coco recommends", d: "Based on profile, weather, season — 3 personalized recommendations with prices in THB." },
{ n: "4", t: "You measure", d: "Every interaction tracked. Monthly report with leads and satisfaction scores." },
],
pricing_h2: "Simple pricing",
plans: [
{ name: "Trial", price: "Free", duration: "14 days", features: ["Fully functional widget", "50 conversations included", "Email support"], cta: "Start trial", highlight: false },
{ name: "Partner", price: "3,500 THB", duration: "/ month", features: ["Unlimited conversations", "6 languages", "White-label widget", "Monthly leads report", "Priority WhatsApp support"], cta: "Contact →", highlight: true },
{ name: "Custom", price: "Contact us", duration: "", features: ["Hotel groups", "Direct API", "Custom integrations", "Guaranteed SLA"], cta: "Let's talk →", highlight: false },
],
faq_h2: "Frequently asked questions",
faqs: [
{ q: "Does Coco really speak 6 languages?", a: "Yes — French, English, Russian, German, Swedish, Chinese. Auto-detected from the very first message." },
{ q: "Do I need technical skills to add the widget?", a: "No. A simple 3-line HTML paste. We handle everything else." },
{ q: "Is my guests' data protected?", a: "Coco stores no personal data. Conversations are not archived." },
{ q: "What happens after the 14-day trial?", a: "The widget deactivates automatically. No billing without your agreement." },
],
footer_tagline: "Koh Samui's local intelligence",
footer_contact: "Contact & partnerships:",
cta_final_h2: "Ready to give guests a local experience?",
cta_final_sub: "Free 14-day trial — no credit card required.",
cta_final_btn: "Get started →",
},
es: {
nav_demo: "Ver demo", nav_hotels: "Hoteles partners", nav_pricing: "Precios",
hero_tag: "Inteligencia local • Koh Samui",
hero_h1: "Tu conserje IA local\nen Koh Samui 🥥",
hero_sub: "Coco conoce cada playa, restaurante y sitio de buceo. Disponible 24/7 en 6 idiomas, listo para integrar en tu web.",
hero_cta1: "Probar Coco gratis", hero_cta2: "Para hoteles →",
stats: [
{ n: "42", l: "hoteles" }, { n: "48", l: "restaurantes" },
{ n: "15", l: "sitios de buceo" }, { n: "6", l: "idiomas" },
],
feat_h2: "Todo lo que sabe Coco",
features: [
{ icon: "🤿", t: "Experto en buceo", d: "Sail Rock, Chumphon Pinnacle, 15 sitios — consejos de instructor PADI profesional." },
{ icon: "🌦️", t: "Adaptable al tiempo", d: "Si el mar está agitado, Coco pasa automáticamente a spas, templos y clases de cocina." },
{ icon: "👨‍👩‍👧", t: "Perfiles personalizados", d: "Familia, luna de miel, viajero solo — recomendaciones en tiempo real." },
{ icon: "💬", t: "6 idiomas", d: "Francés, inglés, ruso, alemán, sueco, chino — detección automática del idioma." },
{ icon: "🏨", t: "Widget marca blanca", d: "3 líneas de código para integrar Coco en tu web. Colores y nombre personalizables." },
{ icon: "📊", t: "Leads rastreados", d: "Cada reserva generada está registrada. Informe mensual incluido en la suscripción." },
],
demo_h2: "Prueba Coco ahora",
demo_sub: "Pregunta lo que quieras sobre Koh Samui — playas, hoteles, buceo, restaurantes, itinerarios...",
demo_placeholder: "Ej: Busco un hotel romántico con vistas al mar...",
hotels_h2: "Para hoteles & resorts",
hotels_sub: "Ofrece a tus huéspedes un conserje IA 24/7, multilingüe, que conoce Samui como un local.",
hotels_features: [
"Widget integrable en 3 líneas de código",
"Colores y nombre de tu marca",
"Recomendaciones prioritarias para tu hotel",
"Informe mensual de leads generados",
"Soporte WhatsApp prioritario",
"Prueba gratuita 14 días — sin compromiso",
],
hotels_price: "3.500 THB / mes",
hotels_cta: "Solicitar demo →",
how_h2: "Cómo funciona",
steps: [
{ n: "1", t: "Tu huésped llega", d: "Un viajero visita tu web. Ve el widget de Coco en la esquina inferior derecha." },
{ n: "2", t: "Hace su pregunta", d: "\"¿Dónde cenar romántico esta noche?\" — Coco responde al instante en 6 idiomas." },
{ n: "3", t: "Coco recomienda", d: "Según perfil, tiempo, temporada — 3 recomendaciones personalizadas con precios en THB." },
{ n: "4", t: "Tú mides", d: "Cada interacción registrada. Informe mensual con leads y satisfacción." },
],
pricing_h2: "Precios simples",
plans: [
{ name: "Prueba", price: "Gratis", duration: "14 días", features: ["Widget funcional completo", "50 conversaciones incluidas", "Soporte email"], cta: "Iniciar prueba", highlight: false },
{ name: "Partner", price: "3.500 THB", duration: "/ mes", features: ["Conversaciones ilimitadas", "6 idiomas", "Widget marca blanca", "Informe mensual leads", "Soporte WhatsApp prioritario"], cta: "Contactar →", highlight: true },
{ name: "Personalizado", price: "Contáctanos", duration: "", features: ["Grupos hoteleros", "API directa", "Integraciones personalizadas", "SLA garantizado"], cta: "Hablemos →", highlight: false },
],
faq_h2: "Preguntas frecuentes",
faqs: [
{ q: "¿Coco habla realmente 6 idiomas?", a: "Sí — francés, inglés, ruso, alemán, sueco, chino. Detección automática desde el primer mensaje." },
{ q: "¿Se necesitan conocimientos técnicos para el widget?", a: "No. Un simple copiar y pegar de 3 líneas de HTML. Nosotros gestionamos el resto." },
{ q: "¿Los datos de mis huéspedes están protegidos?", a: "Coco no almacena datos personales. Las conversaciones no se archivan." },
{ q: "¿Qué pasa al final de los 14 días de prueba?", a: "El widget se desactiva automáticamente. Sin facturación sin tu acuerdo." },
],
footer_tagline: "La inteligencia local de Koh Samui",
footer_contact: "Contacto y partnerships:",
cta_final_h2: "¿Listo para ofrecer una experiencia local a tus clientes?",
cta_final_sub: "Prueba gratuita 14 días — sin tarjeta de crédito.",
cta_final_btn: "Empezar ahora →",
},
ja: {
nav_demo: "デモを見る", nav_hotels: "提携ホテル", nav_pricing: "料金",
hero_tag: "ローカルAI • コサムイ",
hero_h1: "コサムイの\nAIコンシェルジュ 🥥",
hero_sub: "Cocoはコサムイのすべてのビーチ、レストラン、ダイビングスポットを熟知。24時間365日、6言語対応。",
hero_cta1: "Cocoを無料で試す", hero_cta2: "ホテル向け →",
stats: [
{ n: "42", l: "提携ホテル" }, { n: "48", l: "レストラン" },
{ n: "15", l: "ダイビングスポット" }, { n: "6", l: "対応言語" },
],
feat_h2: "Cocoにできること",
features: [
{ icon: "🤿", t: "ダイビング専門家", d: "Sail Rock、Chumphon Pinnacle、15スポット — PADIプロインストラクターのアドバイス。" },
{ icon: "🌦️", t: "天候対応", d: "海が荒れている場合、自動的にスパ、寺院、料理教室をご提案。" },
{ icon: "👨‍👩‍👧", t: "カスタムプロフィール", d: "ファミリー、ハネムーン、一人旅 — リアルタイムでパーソナライズされた提案。" },
{ icon: "💬", t: "6言語対応", d: "フランス語、英語、ロシア語、ドイツ語、スウェーデン語、中国語 — 自動言語検出。" },
{ icon: "🏨", t: "ホワイトラベル", d: "3行のコードでサイトに組み込めます。カラーと名前はカスタマイズ可能。" },
{ icon: "📊", t: "リード追跡", d: "生成された予約はすべて追跡されます。月次レポートも含まれています。" },
],
demo_h2: "今すぐCocoを試す",
demo_sub: "コサムイについて何でも聞いてください — ビーチ、ホテル、ダイビング、レストラン...",
demo_placeholder: "例：海の見えるロマンチックなホテルを探しています...",
hotels_h2: "ホテル・リゾート向け",
hotels_sub: "24時間365日対応、多言語AIコンシェルジュで、ゲストにローカルな体験を。",
hotels_features: [
"3行のコードで組み込み可能",
"ブランドカラーと名前",
"ホテルへの優先推薦",
"月次リード生成レポート",
"WhatsApp優先サポート",
"14日間無料トライアル — コミットメント不要",
],
hotels_price: "3,500 THB / 月",
hotels_cta: "デモを申請 →",
how_h2: "仕組み",
steps: [
{ n: "1", t: "ゲストが訪問", d: "旅行者がホテルサイトを訪問。右下にCocoウィジェットが表示されます。" },
{ n: "2", t: "質問する", d: "「今夜のロマンチックなディナーはどこ？」— Cocoが6言語で即座に回答。" },
{ n: "3", t: "Cocoが提案", d: "プロフィール、天気、シーズンに基づいて — THB価格付きで3つの提案。" },
{ n: "4", t: "効果を測定", d: "すべてのインタラクションを追跡。月次レポートにリードと満足度データが含まれます。" },
],
pricing_h2: "シンプルな料金プラン",
plans: [
{ name: "トライアル", price: "無料", duration: "14日間", features: ["フル機能ウィジェット", "50会話含む", "メールサポート"], cta: "トライアル開始", highlight: false },
{ name: "パートナー", price: "3,500 THB", duration: "/ 月", features: ["会話無制限", "6言語", "ホワイトラベル", "月次リードレポート", "WhatsApp優先サポート"], cta: "お問い合わせ →", highlight: true },
{ name: "カスタム", price: "お問い合わせ", duration: "", features: ["ホテルグループ", "ダイレクトAPI", "カスタム統合", "SLA保証"], cta: "相談する →", highlight: false },
],
faq_h2: "よくある質問",
faqs: [
{ q: "Cocoは本当に6言語で話せますか？", a: "はい — フランス語、英語、ロシア語、ドイツ語、スウェーデン語、中国語。最初のメッセージから自動検出します。" },
{ q: "ウィジェットの組み込みに技術的なスキルは必要ですか？", a: "いいえ。3行のHTMLをコピー＆ペーストするだけです。あとは私たちが全て管理します。" },
{ q: "ゲストのデータは保護されていますか？", a: "Cocoは個人データを保存しません。会話はアーカイブされません。" },
{ q: "14日間のトライアル終了後はどうなりますか？", a: "ウィジェットは自動的に無効になります。ご同意なしに請求は発生しません。" },
],
footer_tagline: "コサムイのローカルインテリジェンス",
footer_contact: "お問い合わせ・パートナーシップ：",
cta_final_h2: "ゲストにローカル体験を提供する準備はできましたか？",
cta_final_sub: "14日間無料トライアル — クレジットカード不要。",
cta_final_btn: "今すぐ始める →",
},
zh: {
nav_demo: "查看演示", nav_hotels: "合作酒店", nav_pricing: "价格",
hero_tag: "本地智能 • 苏梅岛",
hero_h1: "苏梅岛专属\nAI礼宾服务 🥥",
hero_sub: "Coco了解每一片海滩、餐厅和潜水点。全天候24/7，支持6种语言，轻松集成到您的酒店网站。",
hero_cta1: "免费试用Coco", hero_cta2: "酒店专区 →",
stats: [
{ n: "42", l: "合作酒店" }, { n: "48", l: "餐厅" },
{ n: "15", l: "潜水点" }, { n: "6", l: "支持语言" },
],
feat_h2: "Coco的功能",
features: [
{ icon: "🤿", t: "本地潜水专家", d: "帆岩、春蓬尖礁、15个潜水点 — 来自PADI专业教练的建议。" },
{ icon: "🌦️", t: "天气自适应", d: "海况不佳时，Coco自动推荐水疗、寺庙和烹饪课程。" },
{ icon: "👨‍👩‍👧", t: "个性化服务", d: "家庭、蜜月、独行侠 — 实时个性化推荐。" },
{ icon: "💬", t: "6种语言", d: "法语、英语、俄语、德语、瑞典语、中文 — 自动语言检测。" },
{ icon: "🏨", t: "白标小组件", d: "3行代码即可集成到您的网站。颜色和名称完全可定制。" },
{ icon: "📊", t: "线索追踪", d: "每次预约生成均被追踪。订阅包含月度报告。" },
],
demo_h2: "立即体验Coco",
demo_sub: "询问任何关于苏梅岛的问题 — 海滩、酒店、潜水、餐厅、行程...",
demo_placeholder: "例如：我在找一家有海景的浪漫酒店...",
hotels_h2: "酒店与度假村",
hotels_sub: "为您的客人提供24/7多语言AI礼宾，像本地人一样了解苏梅岛。",
hotels_features: [
"3行代码即可嵌入",
"您的品牌颜色和名称",
"您酒店的优先推荐",
"月度线索生成报告",
"WhatsApp优先支持",
"14天免费试用 — 无需承诺",
],
hotels_price: "3,500 泰铢/月",
hotels_cta: "申请演示 →",
how_h2: "工作原理",
steps: [
{ n: "1", t: "客人到访", d: "旅行者访问您的酒店网站，看到右下角的Coco小组件。" },
{ n: "2", t: "提出问题", d: "「今晚哪里可以浪漫晚餐？」— Coco用6种语言即时回答。" },
{ n: "3", t: "Coco推荐", d: "根据个人资料、天气、季节 — 3条带泰铢价格的个性化推荐。" },
{ n: "4", t: "效果衡量", d: "每次互动均被追踪。月度报告包含线索和满意度数据。" },
],
pricing_h2: "简单定价",
plans: [
{ name: "试用", price: "免费", duration: "14天", features: ["全功能小组件", "含50次对话", "邮件支持"], cta: "开始试用", highlight: false },
{ name: "合作伙伴", price: "3,500 泰铢", duration: "/月", features: ["无限对话", "6种语言", "白标小组件", "月度线索报告", "WhatsApp优先支持"], cta: "联系我们 →", highlight: true },
{ name: "定制", price: "联系咨询", duration: "", features: ["酒店集团", "直接API", "定制集成", "SLA保证"], cta: "洽谈合作 →", highlight: false },
],
faq_h2: "常见问题",
faqs: [
{ q: "Coco真的支持6种语言吗？", a: "是的 — 法语、英语、俄语、德语、瑞典语、中文。从第一条消息开始自动检测。" },
{ q: "集成小组件需要技术知识吗？", a: "不需要。只需复制粘贴3行HTML代码。其余一切由我们处理。" },
{ q: "客人的数据是否受到保护？", a: "Coco不存储任何个人数据，对话不会被存档。" },
{ q: "14天试用结束后会怎样？", a: "小组件自动停用，未经您同意不会产生任何费用。" },
],
footer_tagline: "苏梅岛本地智能服务",
footer_contact: "联系与合作：",
cta_final_h2: "准备好为客人提供本地体验了吗？",
cta_final_sub: "14天免费试用 — 无需信用卡。",
cta_final_btn: "立即开始 →",
},
};

type TDict = typeof T.fr;

/* ─── UTILS ────────────────────────────────────────────────────────────── */
function useInView(threshold = 0.15) {
const ref = useRef<HTMLDivElement>(null);
const [visible, setVisible] = useState(false);
useEffect(() => {
const obs = new IntersectionObserver(([e]) => e.isIntersecting && setVisible(true), { threshold });
if (ref.current) obs.observe(ref.current);
return () => obs.disconnect();
}, [threshold]);
return [ref, visible] as const;
}

function FadeIn({ children, delay = 0, className = "" }: { children: React.ReactNode; delay?: number; className?: string }) {
const [ref, visible] = useInView();
return (
<div ref={ref} className={className} style={{
opacity: visible ? 1 : 0, transform: visible ? "translateY(0)" : "translateY(28px)",
transition: `opacity 0.6s ease ${delay}ms, transform 0.6s ease ${delay}ms`,
}}>{children}</div>
);
}

/* ─── ICONS ────────────────────────────────────────────────────────────── */
const CocoMark = ({ size = 44 }: { size?: number }) => (
<svg width={size} height={size} viewBox="0 0 44 44" fill="none">
<circle cx="22" cy="22" r="22" fill={C.teal} />
<path d="M22 8 C16 8 12 14 13 20 C14 26 18 30 22 34 C26 30 30 26 31 20 C32 14 28 8 22 8Z" fill={C.sandLight} />
<circle cx="22" cy="21" r="4" fill={C.teal} />
<circle cx="18" cy="12" r="2.5" fill={C.teal} />
<circle cx="26" cy="12" r="2.5" fill={C.teal} />
</svg>
);

const Send = ({ size = 18 }: { size?: number }) => (
<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
<line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" />
</svg>
);

/* ─── CHAT COMPONENT ────────────────────────────────────────────────────── */
function CocoChat({ t }: { t: TDict }) {
const [messages, setMessages] = useState([
{ role: "assistant", content: "Bonjour ! Je suis Coco 🥥 Votre guide local sur Koh Samui 🌴\n\nJe connais chaque plage secrète, les meilleurs restos, sites de plongée et hôtels. Combien de temps restez-vous ? Êtes-vous en couple, en famille, ou en solo ?" }
]);
const [input, setInput] = useState("");
const [loading, setLoading] = useState(false);
const [error, setError] = useState<string | null>(null);
const endRef = useRef<HTMLDivElement>(null);
const inputRef = useRef<HTMLInputElement>(null);

useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

const send = useCallback(async (text?: string) => {
const msg = text || input.trim();
if (!msg || loading) return;
setInput("");
setError(null);
const next = [...messages, { role: "user", content: msg }];
setMessages(next);
setLoading(true);
try {
const res = await fetch("/api/chat", {
method: "POST",
headers: { "Content-Type": "application/json" },
body: JSON.stringify({ messages: next }),
});
const data = await res.json();
if (!res.ok) throw new Error(data.error || "Error");
const reply = data?.content?.[0]?.text || "...";
setMessages(m => [...m, { role: "assistant", content: reply }]);
} catch {
setError("Service momentanément indisponible. Réessayez dans quelques secondes.");
} finally {
setLoading(false);
setTimeout(() => inputRef.current?.focus(), 100);
}
}, [input, messages, loading]);

const handleKey = (e: React.KeyboardEvent<HTMLInputElement>) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } };

const quickReplies = [
"🏖️ Meilleures plages ?", "🤿 Plongée Sail Rock ?", "🍜 Top restaurants ?", "🗺️ Itinéraire 7 jours"
];

return (
<div style={{ background: C.white, borderRadius: 20, overflow: "hidden", boxShadow: "0 8px 40px rgba(11,53,53,.15)", border: `1px solid ${C.border}`, maxWidth: 560, margin: "0 auto" }}>
{/* Header */}
<div style={{ background: `linear-gradient(135deg, ${C.teal}, ${C.tealDeep})`, padding: "16px 20px", display: "flex", alignItems: "center", gap: 12 }}>
<CocoMark size={38} />
<div>
<div style={{ color: C.white, fontWeight: 700, fontSize: 16, fontFamily: "Cormorant Garamond, serif", letterSpacing: ".5px" }}>Coco 🥥</div>
<div style={{ color: C.tealPale, fontSize: 12 }}>Guide local Koh Samui • En ligne</div>
</div>
<div style={{ marginLeft: "auto", width: 8, height: 8, borderRadius: "50%", background: "#4ADE80", boxShadow: "0 0 6px #4ADE80" }} />
</div>

{/* Messages */}
<div style={{ height: 360, overflowY: "auto", padding: "16px 16px 8px", display: "flex", flexDirection: "column", gap: 12, background: C.tealPale }}>
{messages.map((m, i) => (
<div key={i} style={{ display: "flex", justifyContent: m.role === "user" ? "flex-end" : "flex-start", alignItems: "flex-end", gap: 8 }}>
{m.role === "assistant" && <CocoMark size={28} />}
<div style={{
background: m.role === "user" ? `linear-gradient(135deg, ${C.teal}, ${C.tealLight})` : C.white,
color: m.role === "user" ? C.white : C.textDark,
padding: "10px 14px", borderRadius: m.role === "user" ? "16px 16px 4px 16px" : "16px 16px 16px 4px",
maxWidth: "78%", fontSize: 14, lineHeight: 1.55, whiteSpace: "pre-wrap",
boxShadow: "0 2px 8px rgba(0,0,0,.08)"
}}>{m.content}</div>
</div>
))}
{loading && (
<div style={{ display: "flex", alignItems: "flex-end", gap: 8 }}>
<CocoMark size={28} />
<div style={{ background: C.white, padding: "10px 16px", borderRadius: "16px 16px 16px 4px", display: "flex", gap: 5 }}>
{[0, 1, 2].map(i => <div key={i} style={{ width: 7, height: 7, borderRadius: "50%", background: C.tealLight, animation: `bounce 1.2s ${i * 0.2}s infinite` }} />)}
</div>
</div>
)}
{error && <div style={{ background: "#FFF3F0", border: "1px solid #F4B8A8", color: "#C0503A", padding: "8px 12px", borderRadius: 8, fontSize: 13 }}>{error}</div>}
<div ref={endRef} />
</div>

{/* Quick replies */}
{messages.length < 3 && (
<div style={{ padding: "8px 12px 0", display: "flex", gap: 6, flexWrap: "wrap", background: C.tealPale }}>
{quickReplies.map(q => (
<button key={q} onClick={() => send(q)} style={{ background: C.white, border: `1px solid ${C.border}`, color: C.teal, padding: "5px 10px", borderRadius: 20, fontSize: 12, cursor: "pointer", whiteSpace: "nowrap" }}>
{q}
</button>
))}
</div>
)}

{/* Input */}
<div style={{ padding: "12px 12px 14px", background: C.white, borderTop: `1px solid ${C.border}`, display: "flex", gap: 8, alignItems: "center" }}>
<input
ref={inputRef}
value={input}
onChange={e => setInput(e.target.value)}
onKeyDown={handleKey}
placeholder={t.demo_placeholder}
style={{ flex: 1, border: `1.5px solid ${C.border}`, borderRadius: 24, padding: "10px 16px", fontSize: 14, outline: "none", background: C.tealPale, color: C.textDark, fontFamily: "DM Sans, sans-serif" }}
/>
<button
onClick={() => send()}
disabled={!input.trim() || loading}
style={{ width: 40, height: 40, borderRadius: "50%", background: input.trim() ? `linear-gradient(135deg, ${C.coral}, ${C.coralLight})` : C.border, border: "none", cursor: input.trim() ? "pointer" : "default", display: "flex", alignItems: "center", justifyContent: "center", color: C.white, transition: "all .2s" }}
>
<Send size={16} />
</button>
</div>

<style>{`@keyframes bounce { 0%,80%,100%{transform:scale(0)} 40%{transform:scale(1)} }`}</style>
</div>
);
}

/* ─── MAIN LANDING ──────────────────────────────────────────────────────── */
export default function CocoLanding() {
const [lang, setLang] = useState("fr");
const t = T[lang as keyof typeof T];
const wa = "https://wa.me/66633753316?text=" + encodeURIComponent(lang === "fr" ? "Bonjour ! Je voudrais en savoir plus sur Coco AI Concierge pour mon hôtel." : "Hello! I'd like to learn more about Coco AI Concierge for my hotel.");

const scrollTo = (id: string) => { document.getElementById(id)?.scrollIntoView({ behavior: "smooth" }); };

return (
<div style={{ fontFamily: "DM Sans, sans-serif", color: C.textDark, background: C.cream, overflowX: "hidden" }}>
<style>{`
* { box-sizing: border-box; margin: 0; padding: 0; }
body { background: ${C.cream}; }
a { text-decoration: none; }
button { cursor: pointer; }
h1,h2,h3 { font-family: 'Cormorant Garamond', serif; }
::-webkit-scrollbar { width: 6px; } ::-webkit-scrollbar-thumb { background: ${C.border}; border-radius: 3px; }
@media (max-width: 768px) {
.hero-grid { grid-template-columns: 1fr !important; }
.hotels-grid { grid-template-columns: 1fr !important; }
.stats-grid { grid-template-columns: 1fr 1fr !important; }
}
`}</style>

{/* ── NAV ─────────────────────────────────────────────────────── */}
<nav style={{ position: "sticky", top: 0, zIndex: 100, background: "rgba(250,243,230,.96)", backdropFilter: "blur(12px)", borderBottom: `1px solid ${C.border}`, padding: "0 24px" }}>
<div style={{ maxWidth: 1100, margin: "0 auto", height: 64, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
<div style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }} onClick={() => scrollTo("hero")}>
<CocoMark size={36} />
<span style={{ fontFamily: "Cormorant Garamond, serif", fontSize: 22, fontWeight: 700, color: C.tealDeep, letterSpacing: ".5px" }}>Coco</span>
<span style={{ fontSize: 11, background: C.tealPale, color: C.teal, border: `1px solid ${C.border}`, borderRadius: 20, padding: "2px 8px", fontWeight: 600 }}>Samui AI</span>
</div>
<div style={{ display: "flex", alignItems: "center", gap: 8 }}>
<div style={{ display: "flex", gap: 4, background: C.tealPale, borderRadius: 20, padding: 3, marginRight: 6 }}>
{["fr","en","es","ja","zh"].map(l => (
<button key={l} onClick={() => setLang(l)} style={{ padding: "4px 10px", borderRadius: 16, border: "none", background: lang === l ? C.teal : "transparent", color: lang === l ? C.white : C.tealMid, fontWeight: 600, fontSize: 11, transition: "all .2s" }}>
{l.toUpperCase()}
</button>
))}
</div>
<button onClick={() => scrollTo("demo")} style={{ padding: "8px 16px", borderRadius: 20, background: "transparent", border: `1.5px solid ${C.teal}`, color: C.teal, fontWeight: 600, fontSize: 13 }}>
{t.nav_demo}
</button>
<a href={wa} target="_blank" rel="noopener noreferrer"
style={{ padding: "8px 18px", borderRadius: 20, background: `linear-gradient(135deg, ${C.coral}, ${C.coralLight})`, color: C.white, fontWeight: 700, fontSize: 13 }}>
{t.nav_hotels}
</a>
</div>
</div>
</nav>

{/* ── HERO ────────────────────────────────────────────────────── */}
<section id="hero" style={{ minHeight: "90vh", display: "flex", alignItems: "center", background: `linear-gradient(160deg, ${C.tealDeep} 0%, ${C.tealMid} 55%, ${C.teal} 100%)`, padding: "80px 24px 60px", position: "relative", overflow: "hidden" }}>
<div style={{ position: "absolute", top: -100, right: -100, width: 600, height: 600, borderRadius: "50%", background: "rgba(255,255,255,.03)", pointerEvents: "none" }} />
<div style={{ position: "absolute", bottom: -80, left: -80, width: 400, height: 400, borderRadius: "50%", background: "rgba(232,200,122,.06)", pointerEvents: "none" }} />

<div className="hero-grid" style={{ maxWidth: 1100, margin: "0 auto", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 60, alignItems: "center", width: "100%" }}>
<div>
<FadeIn>
<div style={{ display: "inline-flex", alignItems: "center", gap: 8, background: "rgba(255,255,255,.12)", border: "1px solid rgba(255,255,255,.2)", borderRadius: 24, padding: "6px 16px", marginBottom: 24 }}>
<span style={{ width: 8, height: 8, borderRadius: "50%", background: "#4ADE80", display: "inline-block" }} />
<span style={{ color: C.sandLight, fontSize: 13, fontWeight: 600 }}>{t.hero_tag}</span>
</div>
</FadeIn>
<FadeIn delay={100}>
<h1 style={{ fontSize: "clamp(36px,5vw,58px)", fontWeight: 700, color: C.white, lineHeight: 1.1, marginBottom: 24, whiteSpace: "pre-line" }}>{t.hero_h1}</h1>
</FadeIn>
<FadeIn delay={200}>
<p style={{ fontSize: 18, color: "rgba(255,255,255,.8)", lineHeight: 1.7, marginBottom: 36, maxWidth: 480 }}>{t.hero_sub}</p>
</FadeIn>
<FadeIn delay={300}>
<div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
<button onClick={() => scrollTo("demo")} style={{ padding: "14px 28px", borderRadius: 30, background: `linear-gradient(135deg, ${C.coral}, ${C.coralLight})`, color: C.white, fontWeight: 700, fontSize: 15, border: "none", boxShadow: "0 4px 20px rgba(232,114,74,.4)" }}>
{t.hero_cta1}
</button>
<a href={wa} target="_blank" rel="noopener noreferrer" style={{ padding: "14px 28px", borderRadius: 30, background: "transparent", border: "2px solid rgba(255,255,255,.4)", color: C.white, fontWeight: 700, fontSize: 15 }}>
{t.hero_cta2}
</a>
</div>
</FadeIn>
</div>

<FadeIn delay={200}>
<div className="stats-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
{t.stats.map((s, i) => (
<div key={i} style={{ background: "rgba(255,255,255,.1)", border: "1px solid rgba(255,255,255,.15)", borderRadius: 16, padding: "24px 20px", textAlign: "center", backdropFilter: "blur(8px)" }}>
<div style={{ fontSize: 42, fontFamily: "Cormorant Garamond, serif", fontWeight: 700, color: C.sandLight, lineHeight: 1 }}>{s.n}</div>
<div style={{ fontSize: 13, color: "rgba(255,255,255,.7)", marginTop: 6 }}>{s.l}</div>
</div>
))}
</div>
</FadeIn>
</div>
</section>

{/* ── FEATURES ────────────────────────────────────────────────── */}
<section style={{ padding: "80px 24px", background: C.cream }}>
<div style={{ maxWidth: 1100, margin: "0 auto" }}>
<FadeIn>
<h2 style={{ fontSize: "clamp(28px,4vw,42px)", textAlign: "center", color: C.tealDeep, marginBottom: 12 }}>{t.feat_h2}</h2>
<p style={{ textAlign: "center", color: C.textLight, marginBottom: 56, fontSize: 16 }}>Une connaissance locale exhaustive, disponible 24h/24</p>
</FadeIn>
<div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 24 }}>
{t.features.map((f, i) => (
<FadeIn key={i} delay={i * 80}>
<div style={{ background: C.white, borderRadius: 16, padding: "28px 24px", border: `1px solid ${C.border}`, transition: "box-shadow .2s", height: "100%" }}
onMouseEnter={(e: React.MouseEvent<HTMLDivElement>) => (e.currentTarget.style.boxShadow = "0 8px 30px rgba(11,53,53,.1)")}
onMouseLeave={(e: React.MouseEvent<HTMLDivElement>) => (e.currentTarget.style.boxShadow = "none")}>
<div style={{ fontSize: 36, marginBottom: 14 }}>{f.icon}</div>
<h3 style={{ fontSize: 18, fontWeight: 700, color: C.tealDeep, marginBottom: 10, fontFamily: "Cormorant Garamond, serif" }}>{f.t}</h3>
<p style={{ fontSize: 14, color: C.textMid, lineHeight: 1.65 }}>{f.d}</p>
</div>
</FadeIn>
))}
</div>
</div>
</section>

{/* ── DEMO ────────────────────────────────────────────────────── */}
<section id="demo" style={{ padding: "80px 24px", background: `linear-gradient(180deg, ${C.tealPale} 0%, ${C.cream} 100%)` }}>
<div style={{ maxWidth: 1100, margin: "0 auto" }}>
<FadeIn>
<h2 style={{ fontSize: "clamp(28px,4vw,42px)", textAlign: "center", color: C.tealDeep, marginBottom: 12 }}>{t.demo_h2}</h2>
<p style={{ textAlign: "center", color: C.textLight, marginBottom: 48, fontSize: 16 }}>{t.demo_sub}</p>
</FadeIn>
<FadeIn delay={100}><CocoChat t={t} /></FadeIn>
</div>
</section>

{/* ── HOW IT WORKS ────────────────────────────────────────────── */}
<section style={{ padding: "80px 24px", background: C.cream }}>
<div style={{ maxWidth: 1100, margin: "0 auto" }}>
<FadeIn>
<h2 style={{ fontSize: "clamp(28px,4vw,42px)", textAlign: "center", color: C.tealDeep, marginBottom: 56 }}>{t.how_h2}</h2>
</FadeIn>
<div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 32 }}>
{t.steps.map((s, i) => (
<FadeIn key={i} delay={i * 100}>
<div style={{ textAlign: "center", padding: "0 12px" }}>
<div style={{ width: 56, height: 56, borderRadius: "50%", background: `linear-gradient(135deg, ${C.teal}, ${C.tealLight})`, color: C.white, fontSize: 22, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 16px", fontFamily: "Cormorant Garamond, serif" }}>{s.n}</div>
<h3 style={{ fontSize: 18, color: C.tealDeep, marginBottom: 10, fontFamily: "Cormorant Garamond, serif" }}>{s.t}</h3>
<p style={{ fontSize: 14, color: C.textMid, lineHeight: 1.65 }}>{s.d}</p>
</div>
</FadeIn>
))}
</div>
</div>
</section>

{/* ── HOTELS B2B ──────────────────────────────────────────────── */}
<section id="hotels" style={{ padding: "80px 24px", background: `linear-gradient(135deg, ${C.tealDeep} 0%, ${C.teal} 100%)` }}>
<div className="hotels-grid" style={{ maxWidth: 1100, margin: "0 auto", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 60, alignItems: "center" }}>
<FadeIn>
<div style={{ display: "inline-flex", background: "rgba(255,255,255,.15)", borderRadius: 20, padding: "4px 14px", marginBottom: 16 }}>
<span style={{ color: C.sandLight, fontSize: 12, fontWeight: 700 }}>🏨 PARTENARIATS HÔTELS</span>
</div>
<h2 style={{ fontSize: "clamp(28px,4vw,44px)", color: C.white, marginBottom: 16, lineHeight: 1.1 }}>{t.hotels_h2}</h2>
<p style={{ color: "rgba(255,255,255,.8)", fontSize: 17, lineHeight: 1.7, marginBottom: 32 }}>{t.hotels_sub}</p>
<ul style={{ listStyle: "none", display: "flex", flexDirection: "column", gap: 12, marginBottom: 36 }}>
{t.hotels_features.map((f, i) => (
<li key={i} style={{ display: "flex", alignItems: "center", gap: 12, color: "rgba(255,255,255,.9)", fontSize: 15 }}>
<span style={{ width: 22, height: 22, borderRadius: "50%", background: C.coral, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, flexShrink: 0 }}>✓</span>
{f}
</li>
))}
</ul>
<div style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
<div style={{ fontSize: 28, fontFamily: "Cormorant Garamond, serif", fontWeight: 700, color: C.sandLight }}>{t.hotels_price}</div>
<a href={wa} target="_blank" rel="noopener noreferrer"
style={{ padding: "12px 24px", borderRadius: 24, background: `linear-gradient(135deg, ${C.coral}, ${C.coralLight})`, color: C.white, fontWeight: 700, fontSize: 15 }}>
{t.hotels_cta}
</a>
</div>
</FadeIn>

<FadeIn delay={150}>
<div style={{ background: C.white, borderRadius: 20, padding: "28px 24px", boxShadow: "0 20px 60px rgba(0,0,0,.2)" }}>
<div style={{ fontSize: 13, color: C.textLight, marginBottom: 16, fontWeight: 600 }}>INTÉGRATION 3 LIGNES</div>
<pre style={{ background: C.tealDeep, borderRadius: 12, padding: "16px 18px", fontSize: 12, color: "#88D4D4", overflowX: "auto", lineHeight: 1.7 }}>{`<script
src="https://coco-samui.vercel.app/widget.js"
data-hotel-id="VOTRE_ID"
data-lang="fr"
data-color="${C.teal}">
</script>`}</pre>
<div style={{ marginTop: 20, display: "flex", gap: 10 }}>
{["🇫🇷","🇬🇧","🇷🇺","🇩🇪","🇸🇪","🇨🇳"].map(f => <span key={f} style={{ fontSize: 22 }}>{f}</span>)}
</div>
<div style={{ marginTop: 12, fontSize: 13, color: C.textLight }}>Langues supportées — détection automatique</div>
<div style={{ marginTop: 20, padding: "14px 16px", background: C.tealPale, borderRadius: 12, display: "flex", gap: 12, alignItems: "center" }}>
<span style={{ fontSize: 28 }}>🥥</span>
<div>
<div style={{ fontSize: 14, fontWeight: 700, color: C.tealDeep }}>Essai 14 jours gratuit</div>
<div style={{ fontSize: 12, color: C.textLight }}>Sans carte bancaire • Sans engagement</div>
</div>
</div>
</div>
</FadeIn>
</div>
</section>

{/* ── PRICING ─────────────────────────────────────────────────── */}
<section id="pricing" style={{ padding: "80px 24px", background: C.cream }}>
<div style={{ maxWidth: 1100, margin: "0 auto" }}>
<FadeIn>
<h2 style={{ fontSize: "clamp(28px,4vw,42px)", textAlign: "center", color: C.tealDeep, marginBottom: 48 }}>{t.pricing_h2}</h2>
</FadeIn>
<div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 24, alignItems: "stretch" }}>
{t.plans.map((p, i) => (
<FadeIn key={i} delay={i * 100}>
<div style={{
background: p.highlight ? `linear-gradient(160deg, ${C.teal}, ${C.tealDeep})` : C.white,
borderRadius: 20, padding: "32px 28px",
border: p.highlight ? "none" : `1.5px solid ${C.border}`,
boxShadow: p.highlight ? "0 20px 50px rgba(11,53,53,.2)" : "none",
display: "flex", flexDirection: "column",
transform: p.highlight ? "scale(1.04)" : "scale(1)", position: "relative",
}}>
{p.highlight && <div style={{ position: "absolute", top: -12, left: "50%", transform: "translateX(-50%)", background: C.coral, color: C.white, padding: "4px 16px", borderRadius: 20, fontSize: 12, fontWeight: 700, whiteSpace: "nowrap" }}>⭐ RECOMMANDÉ</div>}
<div style={{ fontSize: 15, fontWeight: 700, color: p.highlight ? C.sandLight : C.textMid, marginBottom: 8 }}>{p.name}</div>
<div style={{ fontSize: 36, fontFamily: "Cormorant Garamond, serif", fontWeight: 700, color: p.highlight ? C.white : C.tealDeep, lineHeight: 1 }}>{p.price}</div>
<div style={{ fontSize: 14, color: p.highlight ? "rgba(255,255,255,.7)" : C.textLight, marginBottom: 28 }}>{p.duration}</div>
<ul style={{ listStyle: "none", display: "flex", flexDirection: "column", gap: 10, marginBottom: 32, flex: 1 }}>
{p.features.map((f, j) => (
<li key={j} style={{ display: "flex", gap: 10, fontSize: 14, color: p.highlight ? "rgba(255,255,255,.9)" : C.textMid, alignItems: "flex-start" }}>
<span style={{ color: p.highlight ? C.sandLight : C.coral, flexShrink: 0, marginTop: 1 }}>✓</span>
{f}
</li>
))}
</ul>
<a href={wa} target="_blank" rel="noopener noreferrer" style={{
padding: "12px 20px", borderRadius: 24, fontWeight: 700, fontSize: 14, textAlign: "center",
background: p.highlight ? `linear-gradient(135deg, ${C.coral}, ${C.coralLight})` : "transparent",
border: p.highlight ? "none" : `1.5px solid ${C.teal}`,
color: p.highlight ? C.white : C.teal,
}}>{p.cta}</a>
</div>
</FadeIn>
))}
</div>
</div>
</section>

{/* ── FAQ ─────────────────────────────────────────────────────── */}
<section style={{ padding: "60px 24px", background: C.tealPale }}>
<div style={{ maxWidth: 800, margin: "0 auto" }}>
<FadeIn>
<h2 style={{ fontSize: "clamp(24px,3.5vw,38px)", textAlign: "center", color: C.tealDeep, marginBottom: 40 }}>{t.faq_h2}</h2>
</FadeIn>
<div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
{t.faqs.map((f, i) => (
<FadeIn key={i} delay={i * 80}>
<div style={{ background: C.white, borderRadius: 14, padding: "20px 24px", border: `1px solid ${C.border}` }}>
<div style={{ fontWeight: 700, color: C.tealDeep, marginBottom: 8, fontSize: 15 }}>{f.q}</div>
<div style={{ color: C.textMid, fontSize: 14, lineHeight: 1.65 }}>{f.a}</div>
</div>
</FadeIn>
))}
</div>
</div>
</section>

{/* ── CTA FINAL ───────────────────────────────────────────────── */}
<section style={{ padding: "80px 24px", background: `linear-gradient(135deg, ${C.tealDeep} 0%, ${C.teal} 100%)`, textAlign: "center" }}>
<FadeIn>
<h2 style={{ fontSize: "clamp(28px,4.5vw,52px)", color: C.white, marginBottom: 16, lineHeight: 1.1 }}>{t.cta_final_h2}</h2>
<p style={{ fontSize: 17, color: "rgba(255,255,255,.8)", marginBottom: 36 }}>{t.cta_final_sub}</p>
<div style={{ display: "flex", gap: 16, justifyContent: "center", flexWrap: "wrap" }}>
<a href={wa} target="_blank" rel="noopener noreferrer"
style={{ padding: "16px 36px", borderRadius: 32, background: `linear-gradient(135deg, ${C.coral}, ${C.coralLight})`, color: C.white, fontWeight: 700, fontSize: 16, boxShadow: "0 8px 30px rgba(232,114,74,.4)" }}>
{t.cta_final_btn}
</a>
<button onClick={() => scrollTo("demo")}
style={{ padding: "16px 36px", borderRadius: 32, background: "transparent", border: "2px solid rgba(255,255,255,.4)", color: C.white, fontWeight: 700, fontSize: 16 }}>
{t.nav_demo}
</button>
</div>
<div style={{ marginTop: 40, color: "rgba(255,255,255,.6)", fontSize: 14 }}>
📞 WhatsApp: <a href={wa} target="_blank" rel="noopener noreferrer" style={{ color: C.sandLight }}>+66 633 753 316</a>
&nbsp;•&nbsp; {t.footer_contact} <a href="mailto:CYRIL.JOSEPH32@gmail.com" style={{ color: C.sandLight }}>CYRIL.JOSEPH32@gmail.com</a>
</div>
</FadeIn>
</section>

{/* ── FOOTER ──────────────────────────────────────────────────── */}
<footer style={{ background: C.tealDeep, padding: "28px 24px", textAlign: "center" }}>
<div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10, marginBottom: 8 }}>
<CocoMark size={28} />
<span style={{ fontFamily: "Cormorant Garamond, serif", color: C.white, fontWeight: 700, fontSize: 18 }}>Coco</span>
</div>
<p style={{ color: "rgba(255,255,255,.5)", fontSize: 13 }}>{t.footer_tagline} • Koh Samui, Thailand 🌴</p>
<p style={{ color: "rgba(255,255,255,.35)", fontSize: 12, marginTop: 6 }}>© 2026 Coconut Projects — Cyril Joseph</p>
</footer>

{/* WhatsApp floating button */}
<a href={wa} target="_blank" rel="noopener noreferrer"
style={{ position: "fixed", bottom: 24, right: 24, zIndex: 999, width: 56, height: 56, borderRadius: "50%", background: "#25D366", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 4px 20px rgba(37,211,102,.4)", fontSize: 26 }}>
💬
</a>
</div>
);
}
