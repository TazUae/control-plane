import frappe
from frappe.utils import random_string

@frappe.whitelist()
def create_api_user(site):
    try:
        frappe.init(site=site)
        frappe.connect()

        frappe.local.lang = "en"

        email = f"api@{site}"

        if frappe.db.exists("User", email):
            user = frappe.get_doc("User", email)
        else:
            user = frappe.get_doc({
                "doctype": "User",
                "email": email,
                "first_name": "API",
                "last_name": "User",
                "enabled": 1,
                "send_welcome_email": 0
            })
            user.insert(ignore_permissions=True)

        roles = [r.role for r in user.roles]
        if "System Manager" not in roles:
            user.append("roles", {"role": "System Manager"})

        if not user.api_key:
            user.api_key = random_string(15)
        if not user.api_secret:
            user.api_secret = random_string(32)

        user.save(ignore_permissions=True)
        frappe.db.commit()

        return {
            "status": "success",
            "site": site,
            "email": email,
            "api_key": user.api_key,
            "api_secret": user.api_secret
        }

    except Exception as e:
        frappe.db.rollback()
        return {
            "status": "error",
            "message": str(e)
        }

    finally:
        frappe.destroy()
