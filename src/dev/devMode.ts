// Dev mode: on with ?dev=1 (remembered in this browser), off with ?dev=0.
const DEV_FLAG_KEY = "computer-query.dev";

export function readDevMode(search: string = location.search): boolean
{
  const param = new URLSearchParams(search).get("dev");

  try
  {
    if (param === "1") localStorage.setItem(DEV_FLAG_KEY, "1");
    if (param === "0") localStorage.removeItem(DEV_FLAG_KEY);

    return localStorage.getItem(DEV_FLAG_KEY) === "1";
  }
  catch
  {
    return param === "1";
  }
}
