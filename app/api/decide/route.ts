import { NextResponse } from 'next/server';
import { callDecide, callComment, type DecideRequest } from '@/lib/openai';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(request: Request) {
  // if (!process.env.OPENAI_API_KEY) {
  //   return NextResponse.json({ error: 'OPENAI_API_KEY가 설정되지 않았습니다.' }, { status: 500 });
  // }
  try {
    const body = (await request.json()) as DecideRequest;
    if (body.stage === 'comment') {
      const text = await callComment(body, {
        seedPost: body.seedPost ?? '',
        topic: '이 글을 본 후, 당신의 생각을 댓글로 짧게 남기세요.',
      });
      return NextResponse.json({ text });
    }
    const decision = await callDecide(body);
    return NextResponse.json(decision);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
