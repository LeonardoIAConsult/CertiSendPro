# Política de Privacidad y Tratamiento de Datos Personales — CertiSend Pro

**Versión:** 2.4 · **Entrada en vigencia:** el día de su publicación en https://certisendpro.online

Debajo de cada sección hay una línea **«En corto»** en lenguaje sencillo.

---

## 1. Responsable del tratamiento

| Dato | Valor |
|---|---|
| Nombre | {{PROVEEDOR_NOMBRE}} (persona natural), titular de CertiSend Pro |
| Cédula de ciudadanía | {{PROVEEDOR_DOC}} |
| Domicilio | Bogotá, Colombia |
| Dirección de notificación | {{PROVEEDOR_DIR}} |
| Correo electrónico | contacto@leonardoantolinez.com |
| Teléfono | {{PROVEEDOR_TEL}} |
| Sitio web | https://certisendpro.online |

**Área que atiende peticiones, consultas y reclamos:** el propio responsable, en el correo **contacto@leonardoantolinez.com** (canal único para datos personales, soporte y pagos).

**En corto:** quien decide sobre tus datos es {{PROVEEDOR_NOMBRE}}; se le escribe a contacto@leonardoantolinez.com.

## 2. Dos papeles distintos: tus datos y los de tus destinatarios

- **Tus datos como usuario** (cuenta, plan, pagos): aquí CertiSend es el **Responsable del tratamiento**. Esta política aplica completa.
- **Los datos de las personas a quienes envías certificados** (nombres y correos de tu lista y los nombres que aparecen en tus PDF): aquí **tú eres el Responsable** y CertiSend actúa como **Encargado del tratamiento**, por cuenta tuya y según tus instrucciones (Ley 1581 de 2012, artículo 3). Las condiciones de ese encargo están en la sección 12 de los Términos y Condiciones. Si eres un destinatario y quieres ejercer tus derechos, dirígete a quien te envió el certificado; si nos escribes a nosotros, le remitiremos tu solicitud y lo apoyaremos.

**En corto:** de tu cuenta y tus pagos respondemos nosotros; de la lista de tus participantes respondes tú, y nosotros solo la usamos para enviar.

## 3. Qué datos tratamos, de dónde salen y dónde viven

| Categoría | Datos | Origen | Dónde viven y por cuánto tiempo |
|---|---|---|---|
| Identificación de tu cuenta | Nombre, correo electrónico, foto de perfil e identificador de usuario de Google | Inicio de sesión con Google (Firebase Authentication) | Firebase Authentication (Google), mientras tengas cuenta |
| Permisos de Google | Token de acceso temporal con dos permisos: enviar correos desde tu Gmail (`gmail.send`) y **leer hojas de cálculo** (`spreadsheets.readonly`). Ese segundo permiso, por cómo lo define Google, **habilita la lectura de todas tus hojas de cálculo**, pero CertiSend **solo lee la hoja que tú indicas** (sus pestañas y las celdas A1:Z1000 de la pestaña que eliges), no busca ni abre otras, y nunca puede modificarlas | Tu autorización al iniciar sesión | Solo en la memoria de tu navegador durante la sesión; viaja al servidor en cada envío y **no se guarda** |
| Cuenta y plan | Plan (Gratis, Paquete o Pago por uso); del Paquete, envíos restantes, reservados y fecha de vencimiento; de Pago por uso, el saldo acumulado y el saldo reservado (sin fecha de vencimiento); e identificador del último pago que activó o aumentó tu plan | Lo genera CertiSend cuando compras | **Base de datos Cloud Firestore (Google)**, colección `cuentas`, mientras tengas cuenta y luego según la sección 7 |
| Pagos | Identificador del pago en Mercado Pago, estado, monto en pesos, TRM usada y su fecha, fecha del cobro, plan, cantidad de envíos comprada (solo en compras de Pago por uso), y el estado de los correos de confirmación. Antes del pago, el cobro preparado (monto, TRM, cantidad si es Pago por uso, tu identificador de usuario). **No** recibimos ni guardamos los datos de tu tarjeta o cuenta bancaria | Mercado Pago, al confirmar cada pago; CertiSend, al preparar el cobro | Cloud Firestore, colecciones `pagosProcesados` y `preferencias`, según la sección 7 |
| Prueba de aceptación | Versión de los Términos aceptada, texto exacto de cada casilla marcada (aceptación de los Términos y declaración de inicio inmediato del servicio), idioma, fecha y hora, identificador de usuario, correo de tu cuenta, plan, modalidad, monto y TRM | Tu clic en las casillas del checkout | Cloud Firestore, colección `aceptaciones`, según la sección 7 |
| Autorización de tratamiento de datos | Versión de esta política que autorizaste, texto exacto de la casilla, idioma, fecha y hora, y tus autorizaciones anteriores si la política cambió de versión | Tu clic en la casilla antes de entrar con Google | Cloud Firestore, colección `autorizaciones`, según la sección 7 |
| Aceptación de los Términos y Condiciones (fuera del checkout) | Versión de los Términos que aceptaste, texto exacto de la casilla, idioma, fecha y hora, y tus aceptaciones anteriores si los Términos cambiaron de versión | Tu clic en la casilla antes de entrar con Google | Cloud Firestore, colección `aceptacionesUso`, según la sección 7 |
| Lotes de envío autorizados | Tu identificador de usuario, número de certificados del lote, plan con que se autorizó, envíos hechos y reservados, fecha de creación y de vencimiento (2 horas). No contiene correos ni nombres de tus destinatarios | El servidor, al autorizar cada lote | Cloud Firestore, colección `lotes`, según la sección 7 |
| Confirmación de cada lote | Fecha y hora, número de certificados y, por cada certificado, una huella con clave secreta (código HMAC) del par página del PDF–fila de tu hoja–correo del destinatario que confirmaste. Es un **dato seudonimizado**: no permite leer los correos sin la clave, que se guarda fuera de la base de datos. No se guarda la lista ni los correos en claro. Sirve para probar qué emparejamiento confirmaste si hay un reclamo | Tu clic al confirmar el envío | Cloud Firestore, según la sección 7 (mismo plazo que los pagos) |
| Avisos enviados | Registro de que se envió tu confirmación de compra (y a quién), y copia del correo en el buzón de envío de contacto@leonardoantolinez.com | Lo genera CertiSend | Cloud Firestore (`pagosProcesados`) y el buzón contacto@leonardoantolinez.com, según la sección 7 |
| Datos de tus destinatarios | Nombres y correos de la hoja de Google Sheets que elijas | Tu hoja de cálculo, leída desde tu navegador | Solo en tu navegador durante la sesión; **no se guardan** en una base de datos de CertiSend |
| Tus certificados | Archivos PDF (que contienen nombres de personas) | Los cargas tú o los exportas desde tu Canva | **Memoria temporal del servidor**, eliminados automáticamente a más tardar unas 2 horas y 10 minutos después de cargarlos |
| Correo enviado | Destinatario, asunto, cuerpo y adjunto | Lo compones tú | Se arma en el servidor y se entrega a Gmail; queda en la carpeta «Enviados» de **tu** Gmail, no en CertiSend |
| Registros técnicos | Mensajes de error del servidor, que pueden incluir una dirección de correo que falló al enviarse | El servidor | Google Cloud Logging, **30 días** (retención por defecto) |
| Token de Canva (opcional) | Token de acceso que pegas para exportar tu diseño | Tú | Viaja al servidor solo para esa exportación; no se guarda |

No tratamos datos sensibles (salud, biometría, origen racial, creencias, etc.) ni los pedimos. No usamos cookies de rastreo ni herramientas de analítica publicitaria.

**En corto:** guardamos tu cuenta, tu plan, tus pagos y la prueba de lo que aceptaste; tus certificados y tus listas no se guardan: los PDF se borran solos en unas dos horas.

## 4. Para qué usamos tus datos (finalidades)

1. **Prestarte el servicio:** iniciar tu sesión, dividir tus PDF, leer los nombres con IA, emparejarlos con tu lista y enviar los correos desde tu Gmail.
2. **Gestionar tu plan:** saber qué plan tienes, contar los envíos con éxito del Paquete y descontarlos (o acumularlos) del saldo de Pago por uso, aplicar los límites en el servidor y mostrarte tu saldo y, si aplica, tu vencimiento.
3. **Cobrar y probar el cobro:** crear el cobro en Mercado Pago, verificar que el pago es real antes de activar tu plan, procesar cada pago una sola vez, y conservar la prueba de la relación comercial y de tu aceptación (Ley 1480 de 2011, artículo 50, literal e).
4. **Avisarte por correo:** enviarte la confirmación de compra, la respuesta a tus solicitudes de reembolso o reversión, y los avisos de cambios en los Términos o en esta política.
5. **Avisar al administrador:** {{PROVEEDOR_NOMBRE}} recibe un correo por cada venta, reembolso o contracargo, con tu identificador de usuario, el plan, el monto y la referencia de Mercado Pago, para atender incidencias.
6. **Atender tus peticiones, quejas, reclamos, reembolsos y reversiones.**
7. **Cumplir obligaciones legales**, comerciales y tributarias.
8. **Proteger el servicio:** limitar abusos (por ejemplo, demasiadas solicitudes de cobro por minuto) y diagnosticar errores.

No vendemos tus datos, no los usamos para publicidad ni los cedemos a terceros para sus propios fines.

**En corto:** usamos tus datos para darte el servicio, cobrarte bien, confirmarte cada compra y atenderte. Nada de publicidad.

## 5. Autorización

5.1. Al iniciar sesión con Google y aceptar esta política, nos autorizas a tratar tus datos para las finalidades de la sección 4, incluidas las transferencias internacionales de la sección 6. La autorización se pide de forma expresa, con una casilla que aparece sin marcar, y **guardamos el registro** de cuándo y qué versión aceptaste (Ley 1581 de 2012, artículo 9; Decreto 1377 de 2013, artículo 7). El silencio no vale como autorización.

5.2. Para las finalidades 3, 4 y 7 relacionadas con una compra, el tratamiento también es necesario para ejecutar el contrato que celebras al pagar.

**En corto:** nos das permiso con una casilla que marcas tú, y guardamos la prueba.

## 6. Con quién compartimos datos y transferencia internacional

CertiSend funciona sobre proveedores que procesan datos **fuera de Colombia**. Los nombramos:

| Proveedor | Rol | Para qué | Dónde procesa | Datos que recibe |
|---|---|---|---|---|
| **Google** — Firebase Authentication, Cloud Run, Cloud Firestore, Cloud Logging | Encargado | Inicio de sesión, servidor de la aplicación, base de datos de cuentas y pagos, registros técnicos | Estados Unidos: servidor en la región us-central1 y base de datos Cloud Firestore en la región us-west1 | Datos de cuenta, plan, pagos, aceptación, PDF en memoria temporal |
| **Google** — Gmail API y Google Sheets API | Encargado (actúa con tu permiso sobre tu propia cuenta) | Enviar los correos desde tu Gmail; leer la hoja que elijas | Infraestructura de Google, incluido Estados Unidos | Correo armado (destinatario, asunto, cuerpo, adjunto); lectura de tu hoja |
| **Google** — Gemini API (inteligencia artificial), servicio pago | Encargado | Leer el nombre del destinatario en cada página del certificado | Infraestructura de Google; según sus términos, el contenido puede almacenarse transitoriamente en cualquier país donde Google tenga instalaciones | La página del PDF y la lista de nombres de tu hoja |
| **Mercado Pago** (grupo Mercado Libre) | **Responsable independiente** de los datos de pago | Procesar el pago y la prevención de fraude bajo **sus propios términos y su propia política de privacidad**, que aceptas directamente con Mercado Pago al pagar | Colombia y los demás países que indique la política de Mercado Pago | CertiSend le envía: plan, monto y una referencia de CertiSend. Los datos de tu tarjeta, cuenta e identificación los entregas tú directamente a Mercado Pago; **CertiSend no los ve**. CertiSend recibe de vuelta solo lo descrito en la fila «Pagos» de la sección 3 |
| **Google** — Apps Script (correo de avisos desde contacto@leonardoantolinez.com) | Encargado | Enviar tu confirmación de compra y los avisos al administrador | Infraestructura de Google, incluido Estados Unidos | Tu correo, plan, monto, TRM, fechas y referencia de pago |
| **Canva** (solo si conectas tu cuenta) | Encargado | Exportar tu diseño como PDF | Infraestructura de Canva, fuera de Colombia | Identificador de tu diseño y el token que pegas |
| Datos abiertos del Estado colombiano (datos.gov.co) | — | Consultar la TRM oficial | Colombia | Ningún dato personal |

**Transferencia y transmisión internacional.** Al aceptar esta política autorizas de forma expresa e inequívoca la transferencia y transmisión de tus datos a estos proveedores fuera de Colombia, para las finalidades indicadas (Ley 1581 de 2012, artículo 26, literal a). En lo relacionado con tus compras, la transferencia también es necesaria para ejecutar el contrato contigo (artículo 26, literal e). Con los encargados aplicamos las condiciones de tratamiento de datos que cada proveedor ofrece a sus clientes (Decreto 1377 de 2013, artículos 24 y 25). Mercado Pago no es encargado de CertiSend: trata los datos de pago por su cuenta, como responsable.

**Uso de tus datos para entrenar IA.** CertiSend no usa tus datos para entrenar modelos. La clave de Gemini que usa CertiSend pertenece a un proyecto de Google Cloud **con facturación activa** (servicio pago, verificado el 2026-10-05). Para el servicio pago, los términos adicionales de la API de Gemini (versión del 2026-04-28) establecen que Google no usa los prompts ni las respuestas, incluidos los archivos enviados, para mejorar sus productos. Si la clave dejara de estar en un proyecto con facturación activa, esta afirmación dejaría de ser cierta y actualizaríamos esta política antes de seguir usando la IA.

**En corto:** tus datos pasan por Google, Mercado Pago y, si lo usas, Canva, varios fuera de Colombia; los nombramos todos y nos autorizas a hacerlo.

## 7. Cuánto tiempo los conservamos

| Datos | Plazo |
|---|---|
| PDF de certificados | Máximo unas 2 horas y 10 minutos, en memoria temporal; se eliminan solos |
| Lista de destinatarios y token de Google | No se guardan en el servidor; desaparecen al cerrar la sesión del navegador |
| Contenido enviado a Gemini (página del PDF y lista de nombres) | CertiSend no lo guarda. Google puede conservarlo por un **periodo limitado**, que sus términos no fijan en días, solo para detectar y prevenir abusos de su política de uso y para requerimientos legales o regulatorios. Ese plazo no lo controla CertiSend |
| Datos de cuenta y plan | Mientras tengas cuenta. Si pides la supresión, se eliminan en los plazos de la sección 9, salvo lo indicado en la fila siguiente |
| Pagos, cobros preparados, prueba de aceptación, lotes, confirmación de lotes, registro de avisos, autorizaciones de tratamiento de datos y aceptaciones de los Términos | **Diez (10) años** desde la operación (criterio conservador basado en la Ley 962 de 2005, artículo 28, para los libros y papeles del comerciante). Cumplido el plazo, se eliminan |
| Registros técnicos | Treinta (30) días, retención por defecto de Google Cloud Logging |

**Cómo se suprime una cuenta.** La supresión se hace **a mano, por solicitud** a contacto@leonardoantolinez.com; no hay borrado automático de cuentas inactivas. Recibida la solicitud, y dentro de los plazos de la sección 9, el responsable: (1) elimina tu usuario de Firebase Authentication; (2) elimina tu documento de la colección `cuentas`; (3) conserva solo los registros de pagos, aceptaciones, autorizaciones, lotes y confirmaciones que deban guardarse por la fila anterior, y los elimina al cumplirse el plazo; y (4) te confirma por correo lo que se suprimió y lo que se conserva, y por qué. Además, puedes retirar el acceso de CertiSend a tu cuenta de Google en cualquier momento (sección 8).

**Periodo de vigencia de la base de datos:** la base de cuentas y pagos de CertiSend estará vigente mientras se preste el servicio y, después, durante los plazos de conservación de esta sección.

**En corto:** los certificados se borran en horas; la cuenta mientras la tengas; los pagos y las pruebas de lo que aceptaste, 10 años.

## 8. Tus derechos

Como titular tienes derecho a (Ley 1581 de 2012, artículo 8):

1. **Conocer, actualizar y rectificar** tus datos.
2. **Solicitar prueba de la autorización** que nos diste.
3. **Ser informado** del uso que damos a tus datos.
4. Presentar quejas ante la **Superintendencia de Industria y Comercio** (SIC).
5. **Revocar la autorización** y **solicitar la supresión** de tus datos, cuando no exista un deber legal o contractual de conservarlos.
6. **Acceder gratuitamente** a tus datos.

Además, puedes retirar en cualquier momento el permiso que diste a CertiSend sobre tu cuenta de Google en https://myaccount.google.com/permissions.

**En corto:** puedes ver, corregir, borrar y pedir prueba de tus datos, gratis, y quejarte ante la SIC.

## 9. Cómo ejercer tus derechos: consultas y reclamos

Escribe a **contacto@leonardoantolinez.com** indicando tu nombre, el correo de tu cuenta, qué pides y, si es un reclamo, los hechos y los documentos que quieras hacer valer.

- **Consultas** (conocer tus datos o la prueba de la autorización): respondemos en máximo **diez (10) días hábiles** desde que la recibimos. Si no es posible, te diremos por qué y te responderemos en máximo **cinco (5) días hábiles** más (Ley 1581 de 2012, artículo 14).
- **Reclamos** (corregir, actualizar, suprimir, revocar o reclamar un incumplimiento): si el reclamo está incompleto, te pediremos dentro de los **cinco (5) días** siguientes que lo completes; si pasan **dos (2) meses** sin que lo hagas, entenderemos que desististe. Recibido completo, marcaremos tu dato con la leyenda «reclamo en trámite» en máximo **dos (2) días hábiles**, y lo resolveremos en máximo **quince (15) días hábiles**; si no es posible, te diremos por qué y lo resolveremos en máximo **ocho (8) días hábiles** más (Ley 1581 de 2012, artículo 15).

**En corto:** escríbenos; las consultas se responden en 10 días hábiles y los reclamos en 15.

## 10. Seguridad

Las comunicaciones con CertiSend viajan cifradas (HTTPS). Los datos de cuentas y pagos solo los escribe y lee el servidor de CertiSend; las reglas de la base de datos impiden que el navegador los lea o modifique directamente. Las credenciales del servidor (como la de Mercado Pago o la de Gemini) se guardan en un gestor de secretos, no en el código. CertiSend no ve ni guarda los datos de tu tarjeta. Ningún sistema es infalible: si ocurre un incidente que afecte tus datos, te lo informaremos y lo reportaremos a la SIC cuando corresponda.

**En corto:** cifrado en tránsito, base de datos cerrada al navegador, y nunca vemos tu tarjeta.

## 11. Inteligencia artificial

Para leer el nombre del destinatario en cada certificado, CertiSend envía la página del PDF y los nombres de tu lista a Gemini, el modelo de inteligencia artificial de Google. La IA **sugiere** el emparejamiento; **no toma decisiones sobre ti ni sobre tus destinatarios**: tú revisas el emparejamiento en pantalla y decides qué se envía. No usamos IA para perfilarte ni para decidir tu plan o tu precio (el precio sale de una fórmula fija, ver Términos, sección 5).

**En corto:** la IA solo lee nombres en tus certificados; quien decide enviar eres tú.

## 12. Menores de edad

**Cuentas.** CertiSend no está dirigido a menores de 18 años; al crear tu cuenta declaras ser mayor de edad (Términos, sección 3.1). Si sabemos que una cuenta pertenece a un menor, la cerraremos y suprimiremos sus datos, salvo los de pagos que la ley obligue a conservar, y lo informaremos a la dirección de la cuenta.

**Destinatarios menores de edad.** Si envías certificados a menores (por ejemplo, estudiantes de un curso), tú eres el responsable de esos datos y debes contar con la autorización de su representante legal, otorgada después de escuchar la opinión del menor, y tratar sus datos respetando su interés superior y sus derechos fundamentales (Ley 1581 de 2012, artículo 7; Decreto 1377 de 2013, artículo 12). CertiSend, como encargado, trata esos datos solo para enviar el certificado que tú indiques, no los usa para ningún fin propio y los elimina en los plazos de la sección 7.

**En corto:** las cuentas son solo para adultos; si envías certificados a menores, necesitas el permiso de sus padres o representantes.

## 13. Registro Nacional de Bases de Datos

La inscripción en el Registro Nacional de Bases de Datos (Ley 1581 de 2012, artículo 25) es obligatoria para sociedades y entidades sin ánimo de lucro con activos superiores a 100.000 UVT y para personas jurídicas de naturaleza pública (Decreto 090 de 2018). El responsable de CertiSend es una persona natural y hoy no está obligado. Si la actividad pasa a una sociedad que supere ese umbral, la base se inscribirá.

**En corto:** hoy no aplica la inscripción; si cambia, se inscribe.

## 14. Cambios a esta política

Si cambiamos esta política de forma que afecte el uso de tus datos, te avisaremos por correo **con al menos treinta (30) días calendario de anticipación**. Si el cambio implica una finalidad nueva, te pediremos una nueva autorización; no tomaremos tu silencio como aceptación.

**En corto:** si cambia algo importante, te avisamos con 30 días y te pedimos permiso de nuevo.

## 15. Vigencia

Versión 2.4 · Fecha: 2026-10-07 · Entrada en vigencia: el día de su publicación. Las versiones anteriores se conservan y se entregan a solicitud.
