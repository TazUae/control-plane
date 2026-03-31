import frappe

@frappe.whitelist()
def health_check(site):
    frappe.init(site=site)
    frappe.connect()

    return {
        "status": "ok",
        "site": site
    }
