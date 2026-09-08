import * as Select from "@radix-ui/react-select";
import { Check, ChevronDown, Plus } from "lucide-react";
import { copy } from "../../copy";
import type { Organization } from "../../lib/types";

export function OrganizationPicker({
  organizations,
  value,
  disabled,
  canCreate,
  onChange,
}: {
  organizations: Organization[];
  value: string;
  disabled: boolean;
  canCreate: boolean;
  onChange: (id: string) => void;
}) {
  return (
    <div className="organization-picker-control">
      <span
        id="organization-picker-label"
        className="organization-picker-label"
      >
        {copy.workspace.navigation.organization}
      </span>
      <Select.Root
        value={value}
        onValueChange={(id) => {
          if (id === "__create") window.location.assign("/organizations/new");
          else onChange(id);
        }}
        disabled={disabled}
      >
        <Select.Trigger
          className="organization-picker-trigger"
          data-organization-id={value}
          aria-labelledby="organization-picker-label"
        >
          <Select.Value
            placeholder={copy.workspace.navigation.selectOrganization}
          />
          <Select.Icon>
            <ChevronDown size={15} aria-hidden />
          </Select.Icon>
        </Select.Trigger>
        <Select.Portal>
          <Select.Content
            className="organization-picker-content"
            position="popper"
            align="start"
            sideOffset={7}
            collisionPadding={12}
          >
            <Select.Viewport className="organization-picker-viewport">
              {organizations.map((organization) => (
                <Select.Item
                  className="organization-picker-item"
                  key={organization.id}
                  value={organization.id}
                  data-organization-id={organization.id}
                  textValue={organization.name}
                >
                  <Select.ItemText>{organization.name}</Select.ItemText>
                  <Select.ItemIndicator>
                    <Check size={16} aria-hidden />
                  </Select.ItemIndicator>
                </Select.Item>
              ))}
              {canCreate && (
                <>
                  <Select.Separator className="organization-picker-separator" />
                  <Select.Item
                    className="organization-picker-item organization-picker-create"
                    value="__create"
                  >
                    <Plus size={16} aria-hidden />
                    <Select.ItemText>
                      {copy.signup.organizationSubmit}
                    </Select.ItemText>
                  </Select.Item>
                </>
              )}
            </Select.Viewport>
          </Select.Content>
        </Select.Portal>
      </Select.Root>
    </div>
  );
}
