#!/usr/bin/env node
/**
 * Import an existing Threads session into the persistent profile.
 *
 * `npm run login` needs a visible browser, which is the single biggest barrier
 * to running this server anywhere without a desktop: a VPS, a container, CI. The
 * session itself is just cookies, so it can be moved.
 *
 * Log in once on a machine that has a display, copy the two cookies, and import
 * them here. No GUI required on this end.
 *
 *   threads-mcp-import-session --sessionid <value> --userid <value>
 *   THREADS_SESSIONID=… THREADS_DS_USER_ID=… threads-mcp-import-session
 *
 * The values live in your browser's devtools under Application → Cookies →
 * threads.com: `sessionid` and `ds_user_id`.
 *
 * ⚠️ A sessionid is a bearer credential for your whole account — anyone holding
 * it is you. Prefer the env-var form so it doesn't land in shell history, don't
 * commit it, and revoke by logging out of Threads if it leaks.
 */
import 'dotenv/config';
import { getContext, closeContext, isLoggedIn, DOMAIN, PROFILE_DIR } from './browser/session.js';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  if (i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--')) {
    return process.argv[i + 1];
  }
  const eq = process.argv.find((a) => a.startsWith(`--${name}=`));
  return eq ? eq.slice(name.length + 3) : undefined;
}

async function main() {
  const sessionid = arg('sessionid') ?? process.env.THREADS_SESSIONID;
  const userid = arg('userid') ?? process.env.THREADS_DS_USER_ID;

  console.log('\n🧵 Threads MCP — import session\n');
  console.log(`Profile directory: ${PROFILE_DIR}`);

  if (!sessionid) {
    console.error(
      '\n❌ No sessionid given.\n\n' +
        '   threads-mcp-import-session --sessionid <value> [--userid <value>]\n' +
        '   THREADS_SESSIONID=… THREADS_DS_USER_ID=… threads-mcp-import-session\n\n' +
        '   Find both under devtools → Application → Cookies → threads.com on a\n' +
        '   machine where you are already signed in.\n',
    );
    process.exit(1);
  }

  const ctx = await getContext(true); // headless is fine; we only write cookies

  // Set on both hosts: Threads reads `sessionid` on .threads.com, and some
  // flows still bounce through instagram.com, which carries its own copy.
  const shared = {
    name: 'sessionid',
    value: sessionid,
    path: '/',
    httpOnly: true,
    secure: true,
    sameSite: 'Lax' as const,
  };
  const cookies = [
    { ...shared, domain: `.${DOMAIN}` },
    { ...shared, domain: '.instagram.com' },
  ];
  if (userid) {
    const uid = {
      name: 'ds_user_id',
      value: userid,
      path: '/',
      secure: true,
      sameSite: 'Lax' as const,
    };
    cookies.push({ ...uid, domain: `.${DOMAIN}`, httpOnly: false });
    cookies.push({ ...uid, domain: '.instagram.com', httpOnly: false });
  }
  await ctx.addCookies(cookies);

  const ok = await isLoggedIn();
  if (ok) {
    console.log('\n✅ Session imported and saved to the profile.');
    if (!userid) {
      console.log(
        '   No --userid given. That is usually fine, but pass `ds_user_id` too if\n' +
          '   `whoami` cannot resolve your handle.',
      );
    }
    console.log('\n   Verify with:  npm run test:live\n');
  } else {
    console.log(
      '\n⚠️  Cookies were written but no valid session was detected.\n' +
        '   The sessionid may be expired or truncated — copy it again, whole.\n',
    );
  }
  await closeContext();
  process.exit(ok ? 0 : 1);
}

main().catch(async (err) => {
  console.error('Import failed:', err);
  await closeContext().catch(() => {});
  process.exit(1);
});
