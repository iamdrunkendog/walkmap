import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import { normalizePlace } from './normalize.js';

export { normalizePlace };

export const naverClientId = defineSecret('NAVER_SEARCH_CLIENT_ID');
export const naverClientSecret = defineSecret('NAVER_SEARCH_CLIENT_SECRET');

export const searchPlaces = onCall(
  {
    secrets: [naverClientId, naverClientSecret],
    region: 'asia-northeast3',
    cors: true,
    maxInstances: 10
  },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', '로그인이 필요합니다.');
    }
    const query = String(request.data?.query || '').trim();
    if (!query || query.length > 100) {
      throw new HttpsError('invalid-argument', '검색어는 1–100자로 입력해 주세요.');
    }

    let clientId, clientSecret;
    try {
      clientId = process.env.NAVER_SEARCH_CLIENT_ID || naverClientId.value();
      clientSecret = process.env.NAVER_SEARCH_CLIENT_SECRET || naverClientSecret.value();
    } catch {
      clientId = process.env.NAVER_SEARCH_CLIENT_ID;
      clientSecret = process.env.NAVER_SEARCH_CLIENT_SECRET;
    }

    if (!clientId || !clientSecret) {
      throw new HttpsError('failed-precondition', '장소 검색 인증 설정이 필요합니다.');
    }

    let response;
    try {
      const url = 'https://naverapihub.apigw.ntruss.com/search/v1/local?' + new URLSearchParams({
        query,
        display: '5',
        start: '1',
        sort: 'random',
        format: 'json'
      });
      response = await fetch(url, {
        headers: {
          'X-NCP-APIGW-API-KEY-ID': clientId,
          'X-NCP-APIGW-API-KEY': clientSecret
        },
        signal: AbortSignal.timeout(10000)
      });
    } catch {
      throw new HttpsError('unavailable', '검색 서버에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.');
    }

    if (response.status === 401 || response.status === 403) {
      throw new HttpsError('permission-denied', '검색 인증 실패: API HUB의 지역 API 선택과 인증 정보를 확인해 주세요.');
    }
    if (response.status === 429) {
      throw new HttpsError('resource-exhausted', '검색 호출 한도를 초과했습니다. 나중에 다시 시도해 주세요.');
    }
    if (!response.ok) {
      throw new HttpsError('internal', '검색 서비스 오류가 발생했습니다.');
    }

    let body;
    try {
      body = await response.json();
    } catch {
      throw new HttpsError('internal', '검색 응답을 읽을 수 없습니다.');
    }

    if (!Array.isArray(body?.items)) {
      throw new HttpsError('internal', '검색 응답 형식이 올바르지 않습니다.');
    }

    return {
      items: body.items.map(normalizePlace).filter(Boolean)
    };
  }
);
