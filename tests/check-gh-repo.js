async function checkRepo() {
    const res = await fetch('https://api.github.com/repos/jacobgbroussard-code/trippo-site/branches');
    const branches = await res.json();
    console.log('Branches:', branches.map(b => b.name));

    const pagesRes = await fetch('https://api.github.com/repos/jacobgbroussard-code/trippo-site/pages');
    console.log('Pages status:', pagesRes.status);
    if (pagesRes.ok) {
        console.log('Pages config:', await pagesRes.json());
    }
}
checkRepo();
