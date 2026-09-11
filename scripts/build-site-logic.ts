export type DemoPackage = {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    [key: string]: unknown;
};

/** Workspace dependency decisions shared by the build and its source-free checks. */
export function shallotDependencies(pkg: DemoPackage): [string, string][] {
    return Object.entries(pkg.dependencies ?? {})
        .filter(
            ([name]) => name === "@dylanebert/shallot" || name.startsWith("@dylanebert/shallot-"),
        )
        .sort(([a], [b]) => a.localeCompare(b));
}

export function nonWorkspaceShallotDependencies(pkg: DemoPackage): [string, string][] {
    return shallotDependencies(pkg).filter(([, pin]) => pin !== "workspace:*");
}

export function workspaceExtensionDependencies(pkg: DemoPackage): string[] {
    return shallotDependencies(pkg)
        .filter(([name, pin]) => name !== "@dylanebert/shallot" && pin === "workspace:*")
        .map(([name]) => name);
}

export function rewriteSiteDependencies(
    pkg: DemoPackage,
    enginePin: string,
    extensionPins: ReadonlyMap<string, string>,
): DemoPackage {
    const dependencies = pkg.dependencies;
    if (!dependencies) return pkg;
    if (dependencies["@dylanebert/shallot"]) dependencies["@dylanebert/shallot"] = enginePin;
    for (const name of workspaceExtensionDependencies(pkg)) {
        const pin = extensionPins.get(name);
        if (!pin) throw new Error(`no packed tarball for workspace extension ${name}`);
        dependencies[name] = pin;
    }
    return pkg;
}
