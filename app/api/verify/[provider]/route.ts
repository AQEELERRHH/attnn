import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { sameOrigin, serverError } from "@/lib/http-guard";
import { LIMITS, limitOrNull } from "@/lib/rate-limit";
import { VERIFY_ERRORS, isSocialProvider } from "@/lib/social-verify-rules";
import { VerificationError, removeVerification } from "@/lib/social-verify";

/** DELETE /api/verify/<provider>: unlinks that account. A live market keeps at least one. */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ provider: string }> }) {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const blocked = sameOrigin(req) ?? (await limitOrNull(LIMITS.profileWrite, session.user.id));
    if (blocked) return blocked;
    const { provider } = await params;
    if (!isSocialProvider(provider)) return NextResponse.json({ error: "Unknown account type" }, { status: 400 });
    await removeVerification(session.user.id, provider);
    return NextResponse.json({ success: true });
  } catch (err) {
    if (err instanceof VerificationError) {
      return NextResponse.json({ error: VERIFY_ERRORS[err.code], code: err.code }, { status: 409 });
    }
    return serverError("verify/unlink", err, "Couldn't unlink that account. Please try again.");
  }
}
