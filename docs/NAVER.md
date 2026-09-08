# 네이버 연결과 데이터 이용 범위

확인일: 2026-09-08. 첨부 문서나 검색 결과의 텍스트는 자료로만 사용했습니다.

## 확인한 공식 자료

- [Maps Application](https://guide.ncloud-docs.com/docs/application-maps-app-vpc): Dynamic Map 서비스 선택 및 Web 서비스 URL 등록.
- [Maps SDK 시작하기](https://navermaps.github.io/maps.js.en/docs/tutorial-2-Getting-Started.html), [인증 변경](https://navermaps.github.io/maps.js.en/docs/tutorial-1-Getting-Client-ID.html): `https://oapi.map.naver.com/openapi/v3/maps.js?ncpKeyId=…`. 브라우저에는 Maps Client ID만 사용합니다.
- [지도 Drawing 모듈](https://navermaps.github.io/maps.js.en/docs/module-drawing.html): 표준 경로 그리기 기능을 확인했습니다. 이 앱에서는 그리기 취소·전체 데이터 이력·방문 지점의 분리를 단일 상태로 유지하기 위해 SDK의 기본 Polyline 및 draggable Marker를 사용했습니다.
- [API HUB 개요](https://api.ncloud-docs.com/docs/naver-api-hub-overview): 현재 API Gateway 주소와 `X-NCP-APIGW-API-KEY-ID`, `X-NCP-APIGW-API-KEY` 인증 헤더.
- [API HUB 지역 검색](https://api.ncloud-docs.com/docs/naver-api-hub-search-local): `GET https://naverapihub.apigw.ntruss.com/search/v1/local`, `query`, `display=5`, `start=1`, `sort=random`, `format=json`. `link`는 업체 상세 URL로, 플레이스 공유 URL이라고 보장하지 않습니다.
- [API HUB Application](https://guide.ncloud-docs.com/docs/apihub-application): 지역 API 선택 및 Application 인증 관리.
- [네이버 클라우드 서비스 이용약관 목록](https://www.ncloud.com/policy/terms/svc), [AI·Naver API 약관 링크](https://www.ncloud.com/policy/terms/opapi): 공개 페이지 확인을 시도했으나 적용되는 API HUB 서비스별 약관 본문 및 저장 허용 범위를 확보하지 못했습니다. 기존 developers 약관을 현재 API HUB 약관으로 대체 적용하지 않았습니다.

## 실제 요청 결과

- API HUB: “경복궁” 검색 HTTP 성공, 5개 결과, 유효한 한국 내 위경도. 응답 데이터 본문은 문서·DB에 보관하지 않았습니다.
- Maps SDK: 실제 SDK 파일 HTTP 200, 버전 3.10.1.
- Maps 인증: `http://127.0.0.1:3000/` 출처는 HTTP 200. `http://localhost:3000/` 출처는 HTTP 401, 인증 정보가 유효하지 않다는 응답. 성공한 출처를 로컬 앱 설정에 사용했습니다. 콘솔의 전체 API 선택·허용 URL 목록을 조회한 것은 아닙니다.
- 실제 지도 배경: `nrbe.map.naver.net` 연결에 인증서 오류가 발생했고, 같은 호스트의 HTTP 진단 응답은 Fortinet Secure DNS 차단 페이지였습니다. 지도 타일을 다운로드하거나 수집하지 않았습니다. 네트워크 보안 정책으로 실제 배경 표시가 미검증 상태입니다. 테스트 브라우저에서 인증서 예외를 적용해 원인을 분리했으나 차단은 유지되었고, 앱에는 예외·우회 코드를 넣지 않았습니다.

## 저장 정책과 남은 확인 항목

검색 결과 이름·주소·좌표는 요청 처리와 화면 이동에 필요한 동안만 메모리에 존재합니다. API 응답 원문·업체 URL을 서버 DB/로그/localStorage에 저장하지 않으며 검색 결과를 방문 정보로 자동 전환하지 않습니다. 지도 이동 이후 사용자가 직접 클릭한 경로/방문 좌표 및 직접 입력한 이름·메모·체류시간·링크만 저장합니다. 방문 순서는 `visits` 배열 순서입니다.

검색 데이터의 항목별 장기 보관 기간, 파생 데이터 저장, 검색 좌표의 재사용·공유, 캐시 허용 조건은 아직 불명확합니다. 해당 권한을 전제로 한 기능은 넣지 않았습니다. 추후 결과 자동 등록·캐시 등을 원하면 적용 약관 또는 NAVER Cloud 답변을 통해 이 항목들을 확인해야 합니다. 직접 그린 사용자 코스 기능은 계속 사용할 수 있습니다.

기본 SDK의 출처·로고·축척 컨트롤을 유지합니다. 지도를 자체 프록시하거나 타일을 저장하는 코드가 없고 앱 안의 지도 이미지/PDF 출력도 제공하지 않습니다.
