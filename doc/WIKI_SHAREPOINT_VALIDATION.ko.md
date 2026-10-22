# Wiki Export 수정과 SharePoint 배포 후보 검증

2026년 10월 22일 기준입니다. 이 문서는 `0.10.1-beta.1` 후보의 구현, 검증 범위와 테스트 볼트 설치 절차를 설명합니다.

[테스트 검증] 로컬 Windows에서 타입 검사, 전체 자동 테스트 226개, 프로덕션 빌드를 통과했습니다. 별도로 공개 저장소 밖에서 첨부 자료를 사용한 4개 검증도 통과했습니다. [미확인] 실제 Obsidian 앱의 렌더링, BRAT 다운로드 설치, SharePoint 업로드 후 동작은 아직 검증하지 않았습니다.

## 기준 코드와 브랜치

[코드 확인] 개발 기준은 원본의 [e1794e7 커밋](https://github.com/fnumatic/obsidian-advanced-html-export/commit/e1794e746149a2e2016af5957c0e91d5a0f3396b)입니다. 분석 당시 설치본은 공식 0.10.0 릴리스의 `main.js`, `styles.css`와 바이트가 같았습니다. 기준 커밋과 0.10.0 태그의 플러그인 소스도 같았습니다.

| 브랜치 | 역할과 의존 관계 |
|---|---|
| `bugfix/wiki-resolution-ids` | 기준 커밋 위에 파일 해석과 페이지 식별 수정 |
| `bugfix/wiki-export-completion` | 위 브랜치 위에 완료·오류·취소 수정 |
| `feature/sharepoint-output` | 위 두 수정 위에 선택적 SharePoint 기능 추가 |
| `integration/wiki-sharepoint` | 최종 통합, 탐색 보강, 후보 버전과 설치 안내 |

[코드 확인] 각 기능은 별도 커밋과 브랜치로 구분했습니다. 브랜치는 앞 단계에 의존하는 구조입니다. 원본과 Fork의 `main`은 변경하지 않으며, 원본 PR·태그·공개 릴리스는 이번 작업에 포함하지 않습니다.

## Wiki 파일 식별 수정

[코드 확인] 이전 구현은 ASCII 중심 `slugify()` 결과로 파일을 찾았습니다. 한글 이름이 빈 문자열이 되면 여러 파일이 같다고 판단했고, 전체 경로의 한글 부분을 지우면 영문 폴더 이름만 남았습니다. 렌더링 결과도 slug를 키로 저장하여 서로 다른 본문이 덮어써졌습니다.

[코드 확인] 이제 `TFile.path`가 문서의 식별자입니다. 링크는 Obsidian의 `getFirstLinkpathDest(linkpath, sourcePath)`가 반환한 파일로 해석하며, 반환값이 없으면 관계없는 파일을 추측하지 않습니다. 페이지 ID는 HTML 탐색에만 사용합니다.

| 파일과 함수 | 변경 사항 |
|---|---|
| `src/utils/wikiExportContext.ts` — `WikiExportContext`, `resolve()`, `pageId()` | 한 번의 내보내기에서 공유할 파일 스냅샷, 경로↔ID 매핑, 출발 문맥별 링크 해석 결과를 관리합니다. |
| `src/utils/wikiLinkCollector.ts` — `findFileByLink()`, `collectLinkedFiles()` | slug 비교를 제거하고 출발 파일 경로를 전달합니다. 캐시의 본문 링크를 우선 사용합니다. |
| `src/utils/linkResolver.ts` — `extractLinks()`, `resolveLinks()` | Wiki·Markdown 링크에 같은 해석기를 적용합니다. YAML Properties, 코드 예제, 주석을 링크 수집에서 제외합니다. URL 인코딩된 Markdown 경로를 처리합니다. |
| `src/utils/wikiExportOrchestrator.ts` — `collectNotes()`, `renderNotesWithProgress()` | ID를 공유 문맥에서 가져오고 본문은 실제 경로별로 저장합니다. |
| `src/utils/wikiHtmlRenderer.ts` — `setResolvablePages()`, `normalizeRenderedLinks()`, `generatePageSections()` | 선택된 경로만 연결하고 같은 경로로 본문을 가져옵니다. 누락·제외 링크는 비활성 표시로 바꿉니다. |
| `src/utils/wikiHtmlRenderer.ts` — `addHeadingIds()` | 한글 제목도 비어 있지 않은 ID를 부여하고, 서로 다른 페이지의 목차 대상이 겹치지 않게 합니다. |
| `src/utils/wikiTemplates/app.js` | 검색에 경로를 포함하고, 사이드바·경로 표시·목차에서 제목을 HTML로 오해하지 않도록 처리합니다. |

[코드 확인] 충돌하지 않는 기존 영문 경로의 ID는 유지합니다. Unicode 경로, 빈 ID, 충돌 그룹에는 전체 경로와 확장자의 SHA-256 일부를 붙입니다. 충돌 검사를 통과하지 못하면 전체 해시와 손실 없는 경로 인코딩으로 대체합니다. 파일 순서에 영향을 받지 않도록 정렬하여 배정합니다. 같은 내보내기에서 문서를 제외해도 남은 문서 ID는 유지됩니다.

[코드 확인] 파일 경로를 소문자로 바꾸거나 Unicode 정규화로 합치지 않습니다. 파일 이동·이름 변경, 볼트에 새 충돌 파일 추가는 ID를 바꿀 수 있습니다. 잘못된 예전 한글 slug의 북마크까지 유지하지는 않습니다. `[[문서#제목]]`과 블록 링크는 문서 대상 해석을 지원하지만, 해당 소제목·블록으로 바로 이동하는 확장 기능은 구현 범위에 포함하지 않았습니다.

## 완료와 오류 처리

[코드 확인] 진행 창은 선택 후 다시 계산한 문서 수를 사용합니다. `runWithProgress()`는 창을 먼저 열고 실제 작업이 끝나면 성공·실패와 관계없이 정리합니다. 화면의 완료 숫자만 기다리는 구조를 제거했습니다.

| 파일과 함수 | 변경 사항 |
|---|---|
| `src/utils/renderLifecycle.ts` — `runWithProgress()`, `awaitRender()` | 창의 수명과 실제 작업을 연결합니다. 비동기 렌더링은 일시정지 시간을 제외한 120초로 제한합니다. |
| `src/utils/wikiExportOrchestrator.ts` — `setSelectedNotes()`, `getRenderSummary()` | 경로 중복을 제거하고 성공·실패·선택 수를 따로 집계합니다. 0개 선택을 전체 선택으로 되돌리지 않습니다. |
| `src/components/renderingProgressStore.svelte.ts` | 경고와 최종 실패를 구별하고, 같은 실패 이벤트를 중복 집계하지 않습니다. 성공과 실패 목록을 따로 표시합니다. |
| `src/utils/cancellationToken.ts`, `src/ui/modals/RenderingProgressModal.ts` | 취소하면 일시정지 대기를 해제하고 콜백을 정리합니다. 창 닫기도 취소로 처리합니다. |
| `src/utils/detailedRenderer.ts` | Markdown 렌더러의 실패를 성공으로 집계하지 않습니다. |
| `src/commands/exportWiki.ts` | 선택→진행 창→렌더링→다운로드를 연결하고 수집 알림을 항상 정리합니다. |

[코드 확인] 일반적인 문서별 오류는 오류 설명 페이지를 만들고 나머지 문서를 계속 처리합니다. 따라서 오류 페이지로 향하는 링크도 실제 페이지를 참조합니다. 제한 시간을 초과하면 아직 실행 중인 렌더러를 재사용하지 않고 전체 내보내기를 실패로 종료하며 파일을 저장하지 않습니다. 취소도 파일을 저장하지 않습니다.

[미확인] 외부 플러그인의 작업 자체를 강제로 중지할 수는 없습니다. 제한 시간은 JavaScript 이벤트 루프가 응답하는 비동기 대기에 적용되며, 앱 자체가 동기 작업으로 멈추는 경우까지 강제 중단하는 기능은 아닙니다.

## SharePoint 설정

[코드 확인] 설정 화면에 다음 옵션을 추가했습니다. 제목과 언어는 HTML 템플릿을 만들 때 적용하며 본문·CSS·스크립트 전체를 치환하지 않습니다. 압축을 사용하면 내부 HTML과 바깥 압축 해제 문서의 제목·언어를 모두 처리하고, BOM은 최종 다운로드에 한 번만 붙입니다.

| 설정 화면 항목 | 기본값 | 동작 |
|---|---|---|
| Enable SharePoint compatibility | OFF | 아래 옵션을 함께 활성화합니다. |
| Remove Exported suffix | ON | 제목 끝의 ` - Exported`만 제거합니다. |
| Encode non-ASCII title characters | ON | `<title>`의 비ASCII 문자를 Unicode 코드 포인트별 숫자 문자 참조로 씁니다. |
| Add UTF-8 BOM | ON | 최종 파일 앞에 `EF BB BF` 3바이트를 추가합니다. |
| Document language | `ko` | 루트 `<html lang>`에 적용합니다. 빈 값·잘못된 형식은 `en`을 사용합니다. |
| HTML display title | 빈 값 | 비워 두면 일반 제목을 사용합니다. Wiki title 설정도 계속 사용할 수 있습니다. |
| Download filename | 빈 값 | 비워 두면 노트 파일명 기반 이름을 사용합니다. 표시 제목과 독립적입니다. |

[코드 확인] 구현 위치는 `exportCompatibility.ts`, `settings.ts`, `main.ts`, `exportSingleFile.ts`, `exportWiki.ts`, 두 HTML 템플릿과 `selfExtract.ts`입니다. `fileUtils.generateSafeFilename()`은 첫 번째 마침표에서 이름을 자르던 문제도 수정했습니다. 예를 들어 `Lab. Meeting.md`는 `Lab._Meeting-wiki.html`로 저장됩니다.

[테스트 검증] OFF에서는 호환성 옵션의 제목·파일명 재정의를 무시하며 일반 제목의 접미사, 기본 언어, BOM 없는 출력을 유지합니다. ON에서는 한글·이모지가 포함된 제목이 DOM에서 원래 문자로 해석되며, 본문·CSS·스크립트·이미지와 Wiki 이동이 유지됩니다. 숫자 참조는 제목의 문자 표기 방식이며, `lang`은 문서 언어입니다. [미확인] 이 옵션들이 모든 SharePoint 환경에서 제목 추출이나 HTML 실행을 보장하지는 않습니다.

## 검증 결과와 실행 환경

[테스트 검증] 실행 환경은 Windows, Node.js 24.20.0, pnpm 11.25.0, TypeScript 6.0.3, Vitest 4.1.10, happy-dom 20.14.5입니다. 자동 테스트는 Obsidian API·MarkdownRenderer·일부 모달을 모의 구현합니다. 실제 플러그인 수집기·오케스트레이터·렌더러·내보내기 명령을 실행하며, 내보낸 JavaScript의 클릭 이벤트도 DOM 모의 환경에서 실행했습니다.

| 검사 | 원본 기준선 | 최종 후보 |
|---|---|---|
| TypeScript 검사 | Windows에서 Svelte 파일명의 대소문자 충돌로 실패 | 통과 |
| 전체 자동 테스트 | 195개 중 189 통과, 6 실패 | 226개 모두 통과 |
| 프로덕션 빌드 | 네이티브 모듈 차단, 이어서 Unix 전용 `cp` 문제 확인 | 공식 WASM 대안을 제공한 로컬 환경에서 통과 |
| 첨부 자료 별도 검증 | 분석에서 빈 ID·본문 충돌·오대상 재현 | 4개 모두 통과 |
| 실제 Obsidian 앱 | 별도 수동 검증 필요 | 아직 검증하지 않음 |
| SharePoint 업로드·교수님 열람 | 별도 수동 검증 필요 | 아직 검증하지 않음 |

[테스트 검증] 원본의 6개 실패는 `RenderingProgress.svelte`와 `renderingProgress.svelte.ts`가 Windows에서 충돌한 문제였습니다. 상태 파일을 `renderingProgressStore.svelte.ts`로 바꾼 후 해결했습니다. 빌드는 파일 복사를 Node.js로 바꿨습니다. 로컬 Windows가 차단한 `oxc-parser` 네이티브 모듈은 검증 폴더에 설치한 동일 공급자의 공식 `@oxc-parser/binding-wasm32-wasi@0.131.0` 대안으로 처리했습니다. 운영체제 보안 정책은 변경하지 않았으며, 이 검증 전용 패키지는 배포 플러그인에 포함하지 않습니다.

[테스트 검증] 공개 테스트에는 영문/한글 폴더, 한글/영문/혼합 이름, 공백·괄호·마침표, 같은 이름의 다른 경로, 확장자 충돌, 강제로 만든 해시 충돌, 누락 링크, 순환 링크, 제외 대상, 상대 경로, URL 인코딩, Properties와 코드 예제, 성공·실패·취소·제한 시간, SharePoint 옵션별 제어가 포함됩니다. 공개 테스트에는 익명화한 자료만 들어 있습니다.

[테스트 검증] 첨부 자료를 읽은 별도 검증에서는 원래 상대 경로, 역순 파일 열거, 일부 노트 제외, 추가 테스트 볼트의 파일을 사용했습니다. 연구 문서 5개 수집, 고유 ID 5개, 관계없는 폴더 제외, 두 본문의 분리, 부분 선택 후 종료를 확인했습니다. 원본 자료와 이 검증 파일은 공개 저장소에 포함하지 않습니다.

## 새 테스트 볼트에서 설치

[코드 확인] 후보의 플러그인 ID는 기존과 같은 `advanced-html-export`입니다. 같은 볼트에 기존판과 Fork판을 함께 설치하면 같은 플러그인 폴더를 사용합니다. **기존 볼트에 설치하지 말고, 새 테스트 볼트를 사용해 주세요.**

1. 후보 ZIP을 별도 폴더에 풉니다. `advanced-html-export` 폴더 안의 `main.js`, `manifest.json`, `styles.css`를 확인합니다.
2. 함께 제공한 익명 예제의 `root-empty-id` 폴더를 새 Obsidian 볼트로 엽니다. `folder-collision`은 또 다른 별도 볼트로 엽니다. 두 예제를 한 볼트로 합치지 않습니다.
3. 각 테스트 볼트의 `.obsidian/plugins/advanced-html-export/`에 후보 파일 세 개를 복사합니다. 기존 설치 파일·설정은 가져오지 않습니다.
4. Obsidian을 다시 열고 커뮤니티 플러그인에서 Advanced HTML Export를 켭니다. 표시 버전이 `0.10.1-beta.1`인지 확인합니다.
5. `Meeting.md`를 열고 `Export wiki as HTML`을 실행합니다. 먼저 SharePoint 모드 OFF, 압축 None으로 검사합니다.
6. 정상 동작을 확인한 뒤 연구 노트 사본을 이 별도 볼트에 넣어 실제 사례를 검사합니다. 원래 폴더 구조를 보존해 주세요.

## Obsidian 수동 체크리스트

- [ ] `root-empty-id` 예제에서 Meeting, 연구가, 연구나, DAVIS alpha 네 문서가 수집됩니다.
- [ ] `folder-collision` 예제에서 Meeting과 연구 두 개만 수집되며 행정 문서는 포함되지 않습니다.
- [ ] 연구가 클릭 시 `BODY_A_ONLY`, 연구나 클릭 시 `BODY_B_ONLY`가 각각 보입니다.
- [ ] 빈 `data-page`, 빈 `page-`, 중복 `.wiki-page` ID가 없습니다.
- [ ] 검색, 사이드바, 홈, 뒤로/앞으로, 한글 목차가 해당 문서를 가리킵니다.
- [ ] 하나의 연구 노트를 제외해도 내보내기가 끝나며, 제외된 링크는 클릭되지 않습니다.
- [ ] `[[없는노트]]`를 추가해도 다른 문서로 연결되지 않습니다.
- [ ] 다른 폴더에 같은 이름의 노트를 만든 뒤 Obsidian에서 여는 대상과 HTML 대상이 일치합니다.
- [ ] 일시정지 후 취소, 렌더링 도중 창 닫기가 끝나고 파일이 저장되지 않습니다.
- [ ] 사용하는 Mermaid·Excalidraw·이미지 플러그인이 실제 렌더러에서 정상 동작합니다.
- [ ] 실패가 있으면 완료 수와 실패 수를 따로 확인하고, 출력된 오류 페이지를 확인합니다.

## SharePoint 수동 체크리스트

1. SharePoint 모드 ON, 압축 None, 언어 `ko`, 표시 제목과 저장 파일명을 서로 다른 한글 값으로 설정합니다.
2. 로컬 브라우저에서 제목·본문·CSS·이미지·Wiki 이동을 확인합니다. 제목 접미사가 없고 파일명은 별도 설정값이어야 합니다.
3. 새 파일명으로 테스트 문서 라이브러리에 업로드합니다. 브라우저 탭 제목, 라이브러리의 이름/제목 열, 미리보기 제목을 각각 기록합니다. 기존 항목의 저장된 메타데이터와 혼동하지 않도록 비교합니다.
4. 교수님과 같은 읽기 권한 계정에서 공유 링크를 엽니다. 로그인 요구, 미리보기·다운로드 동작, JavaScript 허용 여부를 확인합니다.
5. 두 코딩테스트 링크, DAVIS 링크, 이미지, 뒤로/앞으로 이동과 검색을 확인합니다.
6. ON/OFF 결과를 비교하고 필요한 경우 제목 숫자 참조, BOM, 언어 옵션을 하나씩 바꿔 어떤 조합이 효과가 있는지 기록합니다.
7. 압축을 사용할 계획이면 None 검증 뒤 gzip+base64와 gzip+base85를 별도로 확인합니다. 압축 해제에는 브라우저의 `DecompressionStream`과 스크립트 실행이 필요합니다.

[미확인] 라이브러리 정책이 HTML을 다운로드하도록 하거나 스크립트를 막는다면 제목 보정만으로 열람 방식이 바뀌지는 않습니다. 실제 열람 방식은 사용자 환경에서 결정됩니다. 자동 업로드 기능은 포함하지 않습니다.

## BRAT 배포 전 확인

[공식 문서] 현재 BRAT은 GitHub 릴리스의 `manifest.json`, `main.js`, `styles.css`를 다운로드합니다. 브랜치 Push만으로 BRAT 설치가 완성되지는 않습니다. 릴리스 태그·이름·manifest 버전을 맞추고, 테스트 중에는 정확한 버전으로 고정하는 것이 좋습니다. BRAT 1.1.0 이후에는 `manifest-beta.json`을 사용하지 않습니다. [BRAT 개발자 안내](https://github.com/TfTHacker/obsidian42-brat/blob/main/BRAT-DEVELOPER-GUIDE.md)

[코드 확인] 이번 후보는 필요한 세 파일과 동일한 버전을 준비한 상태입니다. 공개 릴리스는 별도 승인 전까지 만들지 않습니다. 승인 후 `ofsungkyun/obsidian-advanced-html-export`에 `0.10.1-beta.1` 프리릴리스와 세 개의 개별 에셋을 올린 뒤, **테스트 볼트에서만** 해당 버전을 BRAT에 등록하면 됩니다. 기존 원본 저장소 추적과 Fork 추적을 같은 볼트에서 동시에 사용하지 마세요.

[미확인] 실제 BRAT 설치·업데이트, 실제 Obsidian 링크 해석의 모호한 이름 우선순위, 외부 렌더러와 SharePoint 읽기 환경의 통합 검증이 남아 있습니다. 자동 테스트 통과는 공개 릴리스나 실사용 볼트 교체의 완료를 의미하지 않습니다.
